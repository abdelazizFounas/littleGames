package match

import (
	"encoding/json"
	"testing"
)

func TestVoiceRoomAuthorizationAndDeparture(t *testing.T) {
	roster := map[string]string{"a": "Alpha", "b": "Bravo", "c": "Charlie"}
	request := func(user, action, peer string) string {
		result, handled := voiceSignal(VoicePayload(VoiceRequest{Voice: true, UserID: user, Action: action, PeerID: peer}), "voice-test", roster)
		if !handled {
			t.Fatal("voice signal ignored")
		}
		return result
	}
	var reply struct {
		Members []voiceMember `json:"members"`
		Error   string        `json:"error"`
	}
	if err := json.Unmarshal([]byte(request("outsider", "join", "peer-00000000000000000000")), &reply); err != nil || reply.Error == "" {
		t.Fatal("outsider accepted")
	}
	for _, id := range []string{"a", "b", "c"} {
		request(id, "join", "peer-00000000000000000000"+id)
	}
	reply.Error = ""
	_ = json.Unmarshal([]byte(request("a", "poll", "peer-00000000000000000000a")), &reply)
	if len(reply.Members) != 3 {
		t.Fatalf("expected full multi-player roster, got %d", len(reply.Members))
	}
	request("b", "leave", "peer-00000000000000000000b")
	_ = json.Unmarshal([]byte(request("a", "poll", "peer-00000000000000000000a")), &reply)
	if len(reply.Members) != 2 {
		t.Fatal("departed member retained")
	}
	if _, handled := voiceSignal(`{"voice":true,"userId":"a","action":"join","peerId":"attacker000000000000000"}`, "voice-test", roster); handled {
		t.Fatal("unsigned lobby-password injection accepted")
	}
}
