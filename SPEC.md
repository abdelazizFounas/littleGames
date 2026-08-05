# Projet : plateforme de mini-jeux multijoueur temps réel

## Rôle attendu

Tu es l'architecte et le développeur principal de ce projet. Tu poses des questions
quand une décision est ambiguë plutôt que de deviner. Tu implémentes **phase par
phase**, et tu t'arrêtes à la fin de chaque phase pour que je valide avant de
continuer.

---

## 1. Objectif

Construire une plateforme web de mini-jeux multijoueur en temps réel, jouable sur
desktop et mobile (navigateur), tres important l'ensemble du site, UI, code, commentaire doit etre en anglais et exclusivement en anglais, avec :

- comptes utilisateurs persistants
- liste de jeux disponibles
- lobby avec création de partie et **invitation d'un ami par lien**
- premier jeu : **Pong 2 joueurs, temps réel, serveur autoritaire**

Le premier jeu est un prétexte pour construire l'infrastructure. L'infrastructure
compte plus que le jeu.

---

## 2. Stack imposée

### Backend
- **Nakama** (self-hosted, Docker) comme serveur de jeu et backend applicatif
- **PostgreSQL** comme base de données de Nakama (pas CockroachDB)
- **Modules serveur Nakama en Go** pour la logique de match autoritaire
- **Caddy** en reverse proxy (TLS automatique, upgrade WebSocket)

### Frontend
- **TypeScript strict** partout (`strict: true`, pas de `any` implicite)
- **Vite** pour le build
- **React** uniquement pour le shell : accueil, auth, liste de jeux, lobby, profil
- **PixiJS** pour le rendu du jeu (canvas WebGL)
- **@heroiclabs/nakama-js** comme SDK client

### Non négociable
- React ne doit **jamais** être dans la boucle de rendu du jeu. La boucle tourne
  dans PixiJS via `requestAnimationFrame`, hors du cycle de re-render React.
- Le code métier des jeux ne doit **jamais** importer PixiJS.

---

## 2 bis. Politique de versions : toujours les plus récentes

> **Règle absolue : à tout moment du projet, tous les outils, langages, images
> Docker, bibliothèques et dépendances doivent être dans leur dernière version
> stable disponible.**

Cela couvre sans exception : Go, Node, pnpm, TypeScript, Vite, React, PixiJS,
Babylon.js le jour où il arrive, le SDK `nakama-js`, l'image Docker Nakama, l'image
PostgreSQL, Caddy, Vitest, ESLint, et toute dépendance transitive qu'il est possible
de faire remonter.

### Procédure obligatoire

1. **Ne jamais se fier à ta mémoire pour un numéro de version.** Tes données
   d'entraînement sont périmées. Avant d'écrire un `package.json`, un `go.mod` ou
   un `docker-compose.yml`, **vérifie la version courante à la source** :
   - npm : `npm view <package> version`
   - Go : `go list -m -versions <module>` et la page des releases Go
   - Docker : le tag `latest` réel sur Docker Hub / le registre Heroic Labs
   - Nakama : les release notes officielles (le format de `nakama.yml` et l'API des
     modules Go changent entre versions majeures)
2. **Épingler la version exacte trouvée**, jamais `latest` ni `^` dans les fichiers
   de config. On veut du récent *et* du reproductible. Le lockfile est commité.
3. **Documenter dans le README** un tableau des versions utilisées, avec la date de
   dernière vérification.
4. **Revérifier au début de chaque phase.** Si une mise à jour est sortie entre-temps,
   signale-la-moi avec le changelog résumé avant de l'appliquer.

### Gestion des ruptures

Une version récente peut casser ce que tu connais. Quand c'est le cas :

- **Lis la doc officielle de la version installée**, ne code pas de mémoire. C'est
  particulièrement critique pour PixiJS (l'API d'initialisation a changé entre
  les majeures), le runtime Go de Nakama, et React.
- Si une bibliothèque récente casse quelque chose d'important et que la version
  précédente fonctionnait, **expose-moi le problème et laisse-moi trancher** — ne
  redescends pas de version en silence.
- Si tu écris du code qui ne compile pas ou lève une erreur d'API inconnue, le
  premier réflexe est de **vérifier la signature dans la doc de la version épinglée**,
  pas d'essayer une autre syntaxe au hasard.

### Maintenance continue

- `pnpm outdated` et `go list -u -m all` à chaque début de phase ; rapporte-moi le
  résultat.
- Toute alerte de sécurité (`pnpm audit`) est traitée immédiatement.
- Les mises à jour majeures se font sur une branche dédiée, avec les tests qui passent
  avant merge.

---

## 3. Contrainte d'architecture centrale

> **La logique de jeu et la couche réseau doivent être totalement indépendantes
> du moteur de rendu.**

Objectif : pouvoir ajouter Babylon.js plus tard pour des jeux 3D, sans toucher à
la logique, au réseau, ni au lobby.

### Découpage en packages (monorepo pnpm workspaces)

```
/packages
  /core          → types partagés, protocole réseau, utils. ZÉRO dépendance runtime.
  /net           → client Nakama, gestion socket, reconnexion, prédiction, interpolation.
                   Dépend de /core uniquement.
  /games
    /pong
      /logic     → règles, physique, state machine. Pur TS, testable en Node,
                   AUCUN import de rendu ni de réseau.
      /renderer-pixi → implémente l'interface GameRenderer avec PixiJS.
  /ui            → shell React (routes, lobby, auth, liste de jeux)

/server
  /nakama        → modules Go (match handler, RPCs, hooks)
  /docker        → docker-compose.yml, Caddyfile, config Nakama
```

### Le contrat de rendu

Définis dans `/core` une interface que tout moteur doit implémenter :

```ts
interface GameRenderer<TState> {
  mount(container: HTMLElement): Promise<void>;
  render(state: TState, interpolationAlpha: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
```

Le jeu reçoit un `GameRenderer` par injection. Il ne sait pas si c'est Pixi ou
Babylon derrière. **Preuve que la séparation est correcte** : je dois pouvoir
écrire un `HeadlessRenderer` qui ne fait rien, et faire tourner une partie complète
en test unitaire sans navigateur.

Le même principe s'applique aux entrées : définis un `InputSource` abstrait
(clavier, tactile, IA de test) qui produit des `InputCommand` typés.

---

## 4. Fonctionnalités Nakama à exploiter

Utilise les primitives natives de Nakama plutôt que de réimplémenter. Liste des
fonctionnalités attendues :

| Domaine | Primitive Nakama | Usage |
|---|---|---|
| Auth | Device ID + email/password + refresh token | Connexion invité en 1 clic, upgrade vers compte email |
| Profil | Account, `displayName`, `avatarUrl`, `metadata` | Pseudo, avatar, préférences |
| Liste de jeux | Storage Engine (collection `catalog`, lecture publique) | Catalogue éditable sans redéploiement |
| Salles | Authoritative Match (`match_handler` Go) | État de partie côté serveur |
| Invitation | **Party API** + code de partie court | Inviter un ami par lien |
| Matchmaking | Matchmaker (`addMatchmaker`) | Trouver un adversaire aléatoire |
| Présence | Match presence + Status | Qui est en ligne, qui est en partie |
| Classements | Leaderboards + Tournaments | Score par jeu, reset hebdomadaire |
| Notifications | Notification API | « X t'invite à jouer » |
| Stats joueur | Storage (collection `stats`, permission owner-read) | Parties jouées, victoires, ratio |
| Analytics | Hooks `before/after` + événements custom | Suivi des parties, funnel lobby → partie |
| Logique custom | RPC (Go) | Création de lien d'invitation, résolution de code |
| Anti-triche | Serveur autoritaire uniquement | Le client n'envoie que des inputs |

**Important** : le client n'écrit jamais directement dans le storage pour les
données sensibles (scores, stats). Ça passe par des RPCs serveur.

---

## 5. Spécification du Pong

### Modèle réseau
- **Serveur autoritaire.** Le client envoie uniquement `{ up: bool, down: bool, seq: int }`.
  Jamais de position.
- **Tick rate serveur : 30 Hz.** Broadcast de l'état à chaque tick.
- **Client-side prediction** sur sa propre raquette, avec réconciliation
  (le serveur renvoie le dernier `seq` traité ; le client rejoue les inputs postérieurs).
- **Interpolation d'entités** : la raquette adverse et la balle sont affichées avec
  ~100 ms de retard, interpolées entre les deux derniers snapshots reçus.
- **Snapshot** : envoie l'état complet (c'est minuscule ici). Pas de delta encoding
  pour l'instant, on optimisera si besoin.

### Règles
- Terrain en coordonnées logiques fixes (ex. 800×600), indépendantes de la taille
  d'écran. Le renderer scale.
- Physique déterministe en pas de temps fixe (`dt = 1/30`), jamais dépendante du
  framerate.
- Premier à 11 points. Accélération de la balle à chaque échange.
- Angle de rebond dépendant du point d'impact sur la raquette.

### Cycle de vie du match
`WAITING` (1 joueur) → `COUNTDOWN` (3 s) → `PLAYING` → `POINT_SCORED` → `PLAYING` → `FINISHED`

- Si un joueur se déconnecte : 30 s de grâce pour se reconnecter, sinon forfait.
- À `FINISHED` : écriture du score au leaderboard + màj des stats via RPC.

---

## 6. Parcours d'invitation (à soigner)

C'est la fonctionnalité la plus importante du produit.

1. Joueur A clique « Inviter un ami » depuis le lobby
2. Le serveur crée une **Party** Nakama et retourne un code court (6 caractères,
   alphabet sans ambiguïté : pas de `0`/`O`, `1`/`I`)
3. Le front génère `https://mondomaine.fr/join/ABC123` + bouton de partage natif
   (`navigator.share` sur mobile, copie presse-papier en fallback)
4. Joueur B ouvre le lien → auth automatique en invité s'il n'a pas de compte →
   rejoint la party
5. Les deux voient un écran « prêt ». Quand les deux sont prêts, le serveur crée
   le match et y transfère la party
6. Si le code est invalide ou la party pleine : message clair, pas un écran blanc

Le code de partie est résolu par un **RPC serveur**, avec expiration (30 min).

---

## 7. Contraintes mobile

À traiter dès le départ, pas à la fin :

- **Reconnexion automatique** du socket avec backoff exponentiel + resynchro
  complète de l'état. Le passage Wi-Fi ↔ 4G ne doit pas casser la partie.
- **Mise en arrière-plan** : détecter `visibilitychange`, mettre le rendu en pause,
  et resynchroniser proprement au retour. Ne pas simuler en aveugle.
- **Contrôles tactiles** conçus dès le premier écran (zone de glissement verticale,
  pas un joystick).
- **Audio** : ne rien démarrer avant une interaction utilisateur (contrainte iOS).
- PWA installable : manifest, service worker, mode plein écran.
- Tester systématiquement avec throttling réseau activé (200 ms RTT minimum).

---

## 8. Plan de livraison

Implémente dans cet ordre. **Arrête-toi et attends ma validation à la fin de
chaque phase.**

**Phase 0 — Infra**
Docker Compose (Nakama + Postgres + Caddy), squelette monorepo, TS strict,
module Go compilé et chargé par Nakama. Livrable : `docker compose up` fonctionne,
console Nakama accessible, le module Go log au démarrage.

**Phase 1 — Auth & shell**
Connexion invité, upgrade email, profil, écran d'accueil. Livrable : je me connecte
et je vois mon pseudo.

**Phase 2 — Catalogue & lobby**
Liste de jeux depuis le Storage Engine, écran lobby. Livrable : je vois la liste
des jeux (Pong seul pour l'instant).

**Phase 3 — Match handler**
Match authoritative Go, boucle 30 Hz, protocole de messages typé partagé entre
Go et TS. Livrable : deux clients rejoignent un match et échangent des messages.

**Phase 4 — Pong logique**
`/games/pong/logic` en TS pur + portage de la physique en Go côté serveur.
**Tests unitaires obligatoires sur la logique.** Livrable : les tests passent,
une partie se déroule en headless.

**Phase 5 — Pong rendu Pixi**
`renderer-pixi`, contrôles clavier + tactile, interpolation, prédiction.
Livrable : Pong jouable à deux.

**Phase 6 — Invitation**
Party API, code court, lien de partage, deep link.
Livrable : j'envoie un lien à quelqu'un et on joue.

**Phase 7 — Persistance & analytics**
Leaderboard, stats joueur, notifications, hooks analytics.

**Phase 8 — Mobile hardening**
Reconnexion, background, PWA, tests sous latence.

---

## 9. Règles de travail

- **Pas de code mort ni de placeholder.** Si une fonctionnalité n'est pas dans la
  phase courante, ne l'esquisse pas.
- **Tests unitaires sur toute la logique de jeu** (Vitest). C'est la seule partie
  que je peux vérifier sans lancer le navigateur.
- **Un seul protocole de vérité** : les types de messages réseau sont définis une
  fois et partagés. Si Go et TS divergent, génère les types depuis une source unique.
- **Commits atomiques** avec messages descriptifs, un par étape logique.
- **README à jour** à chaque phase : comment lancer, comment tester, ce qui marche.
- **Variables d'environnement** pour toute config (clés Nakama, URLs). Jamais en dur.
- **Vérifier les versions à la source avant chaque installation** (voir section 2 bis).
  Aucun numéro de version écrit de mémoire.
- Quand tu hésites entre deux approches, **expose-moi le choix** au lieu de trancher
  seul.

---

## 10. Ce que je veux éviter

- Une logique de jeu couplée à PixiJS → rendrait Babylon impossible à ajouter
- Un client autoritaire → triche triviale
- Une physique dépendante du framerate → désync entre joueurs
- React qui re-render pendant la partie → chutes de framerate
- Réimplémenter à la main ce que Nakama fournit (matchmaking, parties, présence)
- Un bundle qui charge tous les moteurs de rendu même pour un jeu 2D
  → chaque jeu doit être en `import()` dynamique

---

**Commence par la Phase 0. Avant d'écrire du code :**

1. **Vérifie à la source** (npm, Docker Hub, releases GitHub, doc officielle) la
   dernière version stable de chaque outil de la stack — Go, Node, pnpm, TypeScript,
   Vite, React, PixiJS, nakama-js, image Nakama, PostgreSQL, Caddy, Vitest.
2. Présente-moi un **tableau des versions** retenues, avec pour chacune la source
   consultée et la date.
3. Signale toute rupture d'API notable par rapport aux usages courants (typiquement
   PixiJS et le runtime Go de Nakama).
4. Propose l'arborescence complète du projet.

**Puis attends ma validation avant d'écrire la moindre ligne.**
