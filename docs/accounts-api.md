# API du mode comptes

Le mode `accounts` est sélectionné avec `TMUXATLAS_AUTH=accounts` ou
`--auth accounts`. L’amorçage et les limites d’isolation Unix sont décrits
dans le [README](../README.md#comptes-atlas). Les identifiants de propriétaire
sont les champs `id` stables des comptes ; une session libre a `owner: null`.

## Authentification

Les mutations exigent l’en-tête `Origin` correspondant à `TMUXATLAS_PUBLIC_URL`.
Après connexion, elles exigent également `X-TmuxAtlas-CSRF`, dont la valeur est
fournie par la connexion et le statut. Les corps indiqués ci-dessous sont JSON
et utilisent `Content-Type: application/json`. Le cookie de session est
`HttpOnly`, `SameSite=Strict`, `Path=/` et `Secure` si la requête est en HTTPS
(les en-têtes de proxy ne sont utilisés que depuis la boucle locale).

| Route | Corps ou réponse |
|-------|------------------|
| `POST /api/auth/login` | `{"username":"alice","password":"…"}` ; réponse `{"authenticated":true,"username":"alice","role":"user","csrf_token":"…"}` et cookie. Échec : 401 générique ; limitation : 429. |
| `GET /api/auth/status` | `{"mode":"accounts","authenticated":false,"username":"","role":""}` ; une session active contient aussi `csrf_token`. |
| `POST /api/auth/logout` | Révoque la session courante et renvoie 204. |
| `POST /api/auth/change-password` | `{"old_password":"…","new_password":"…"}` ; 204, les autres sessions du compte sont révoquées. |

Les noms respectent `^[a-zA-Z0-9._-]{2,32}$` et sont uniques sans distinction
de casse. Les mots de passe contiennent de 10 à 200 caractères. Les réponses
ne contiennent ni mot de passe ni hash.

## Administration

Ces routes exigent le rôle `admin`. Un objet compte a la forme
`{"id":"…","username":"alice","role":"user","disabled":false,"created_at":"…","password_changed_at":"…"}`.

| Route | Corps ou réponse |
|-------|------------------|
| `GET /api/admin/users` | `{"users":[…]}`. |
| `POST /api/admin/users` | `{"username":"alice","password":"…"}` ; 201 et objet compte. Le rôle créé est toujours `user`. |
| `PATCH /api/admin/users/{id}` | `{"password":"…","disabled":true}` ; les deux champs sont facultatifs, mais au moins un est requis. Réponse : objet compte. |
| `DELETE /api/admin/users/{id}` | Libère les sessions connues du compte et le supprime ; 204. La suppression échoue si un hôte connu est hors ligne. |
| `GET /api/admin/sessions` | Tableau des vues complètes des sessions et de leur `owner`. |

Un administrateur ne peut pas se désactiver ou se supprimer, ni désactiver ou
supprimer le dernier administrateur actif. Désactivation, réinitialisation du
mot de passe et suppression révoquent les sessions du compte.

## Sessions et autorisations utilisateur

Les actions utilisent `host_id` pour identifier explicitement l’hôte. Les
réponses d’action réussies ont la forme `{"request_id":"…","result":{…}}`.

| Route | Paramètres |
|-------|------------|
| `POST /api/session/claim` | `{"host_id":"…","session":"travail"}` ; une session déjà attribuée renvoie 409 avec `code: "already-owned"`. Un administrateur peut ajouter `"owner":"<id>"` pour réattribuer. |
| `POST /api/session/release` | `{"host_id":"…","session":"travail"}` ; l’administrateur peut libérer toute session. |
| `POST /api/session/new` | `{"host_id":"…","session":"travail","cwd":"…","agent":"…"}` ; `cwd` et `agent` sont facultatifs. Le créateur devient propriétaire. |
| `POST /api/session/rename` | `{"host_id":"…","session":"travail","new_name":"nouveau"}`. |
| `POST /api/session/kill` | `{"host_id":"…","session":"travail"}`. |
| `POST /api/session/select-window` | `{"host_id":"…","session":"travail","window":0,"pane":"%1"}` ; `pane` est facultatif. |
| `POST /api/session/select-pane` | `{"host_id":"…","session":"travail","pane":"%1"}`. |
| `POST /api/session/reply` | `{"host_id":"…","session":"travail","pane":"%1","key":"1","fingerprint":"…"}`. |
| `GET /api/session/preview` | Paramètres `host_id`, `session`, et facultativement `pane`, `lines`. |
| `GET /api/session/directories` | Paramètre `host_id`. |
| `DELETE /api/tool-event` | `{"host":"…","session":"travail","window":0,"pane":"%1"}`. |
| `GET /ws/session` | Paramètres `host`, `name`, et facultativement `cols`, `rows` ; terminal PTY. |
| `GET /ws/events` | Paramètre `schema=1` ; instantanés filtrés par compte. |

Le rôle `user` peut aussi lire `/api/sessions`, `/api/hosts`,
`/api/tool-events`, `/api/activity`, `/api/preferences` et son statut, se
déconnecter et changer son mot de passe. Le propriétaire d’une session est une
simple étiquette : tout compte connecté voit et utilise toutes les sessions,
et peut en changer le propriétaire ou les libérer. Les autres routes protégées sont
refusées par défaut, notamment administration, surveillance, statistiques,
peers, voix, push et écriture des préférences.
