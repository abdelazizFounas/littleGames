package match

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// Voice membership is checked against the active game's seated identities.
// Peer IDs are opaque capabilities, never derived from public user or match IDs.
type VoiceRequest struct {
	Token  string `json:"token"`
	Voice  bool   `json:"voice"`
	UserID string `json:"userId"`
	Action string `json:"action"`
	PeerID string `json:"peerId"`
}
type voiceMember struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	PeerID string `json:"peerId"`
	Seen   int64  `json:"-"`
}

var voiceSignalKey = func() string {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes[:])
}()

func VoicePayload(request VoiceRequest) string {
	request.Token = voiceSignalKey
	data, _ := json.Marshal(request)
	return string(data)
}

var voiceRooms = struct {
	sync.Mutex
	rooms map[string]map[string]voiceMember
}{rooms: make(map[string]map[string]voiceMember)}

func voiceSignal(data, matchID string, roster map[string]string) (string, bool) {
	if !strings.HasPrefix(data, "{") {
		return "", false
	}
	var request VoiceRequest
	if len(data) > 1024 || json.Unmarshal([]byte(data), &request) != nil || !request.Voice || request.Token != voiceSignalKey {
		return "", false
	}
	name, allowed := roster[request.UserID]
	if !allowed {
		return `{"error":"Only players in this match can join its voice room."}`, true
	}
	voiceRooms.Lock()
	defer voiceRooms.Unlock()
	now := time.Now().Unix()
	for room, members := range voiceRooms.rooms {
		for id, member := range members {
			if now-member.Seen > 15 {
				delete(members, id)
			}
		}
		if len(members) == 0 {
			delete(voiceRooms.rooms, room)
		}
	}
	members := voiceRooms.rooms[matchID]
	if members == nil {
		members = map[string]voiceMember{}
		voiceRooms.rooms[matchID] = members
	}
	switch request.Action {
	case "join", "poll":
		if len(request.PeerID) < 20 || len(request.PeerID) > 100 {
			return `{"error":"Invalid voice identity."}`, true
		}
		if request.Action == "join" {
			members[request.UserID] = voiceMember{UserID: request.UserID, Name: name, PeerID: request.PeerID, Seen: now}
		} else if current, ok := members[request.UserID]; ok && current.PeerID == request.PeerID {
			current.Seen = now
			members[request.UserID] = current
		} else {
			return `{"error":"Your voice session expired. Join again."}`, true
		}
	case "leave":
		if current, ok := members[request.UserID]; ok && current.PeerID == request.PeerID {
			delete(members, request.UserID)
		}
	default:
		return `{"error":"Unknown voice action."}`, true
	}
	list := []voiceMember{}
	for id, member := range members {
		if _, present := roster[id]; present {
			list = append(list, member)
		} else {
			delete(members, id)
		}
	}
	result, _ := json.Marshal(map[string]interface{}{"members": list})
	return string(result), true
}
