# Vision Hold Clicker

Version actuelle : **5.1.0**.

### Entrees Windows ordonnees 5.1.0

Les deplacements `SetCursorPos` successifs pouvaient etre fusionnes par Windows avant le traitement des clics par Chrome. Chaque lot est maintenant une seule sequence `SendInput` atomique contenant, pour chaque cible, un deplacement absolu sur le bureau virtuel suivi de bouton bas et bouton haut. Les quatre positions restent ainsi ordonnees dans la file d'entree Windows.

## Mode d'envoi des scores

Le fichier `background.js` contient l'option explicite suivante :

```js
const SEND_SCORE_DATA = false;
```

Avec `false`, les requetes `POST` vers le service de classement sont bloquees pendant le bot, tandis que les requetes `GET` restent autorisees pour consulter le classement. Ce mode doit rester actif pour tous les tests automatises.

Deux robots sont inclus :

- **Reaction** : attend l'apparition de la cible, respecte le minimum de 100 ms et utilise le clic Windows natif.
- **Gridshot** : repere chaque cellule, deplace physiquement le curseur au centre du tapis et clique avec Windows.

### Correction 4.1.0

La version 4.0 pouvait rester sur `TOUCHE MAINTENUE` avec zero detection : le compagnon C# lisait les proprietes JSON avec une casse differente de JavaScript, puis repondait avec l'identifiant `0`. La 4.1 accepte les noms JSON sans tenir compte de la casse, conserve l'identifiant de chaque demande et affiche une erreur apres deux secondes au lieu de rester bloquee.

### Correction 4.2.0

La permission `chrome.debugger` a ete entierement supprimee. Le bandeau « Vision Hold Clicker a demarre le debogage » ne doit plus apparaitre. La publication des scores de test est bloquee temporairement avec `declarativeNetRequest`, puis la regle est retiree a l'arret du robot.

### Correction 4.3.0

Les requetes `GET` du classement restent autorisees pendant le test : le panneau ne doit plus afficher « Connexion indisponible ». Seules les requetes `POST` susceptibles de publier un score automatise sont bloquees.

### Optimisation 4.4.0

La regle de protection reseau est maintenant installee une seule fois par session au lieu d'etre recalculee avant chaque clic. L'attente fixe apres `SendInput` est remplacee par une confirmation rapide du changement de cellule, avec un delai maximal de 30 ms.

### Mode Turbo 4.5.0

La boucle ne s'arrete plus apres le premier tapis. Les quatre cibles visibles sont traitees sequentiellement dans chaque lot, puis toutes les cibles deplacees sont reprises au cycle suivant. Les statistiques de l'extension ne sont ecrites qu'une fois par lot afin de ne pas ralentir les clics.

### Mode Ultra 4.6.0

Les attentes de confirmation et de recuperation ont ete supprimees du chemin critique. Une cible non deplacee est retentee a l'image suivante. Le compagnon verifie avec `GetCursorPos` que Windows a reellement place le curseur au point demande avant d'envoyer le clic.

### Lots natifs et diagnostic 4.7.0

Les quatre cibles Gridshot sont envoyees au compagnon Windows dans une seule commande au lieu de quatre allers-retours extension/programme. Le compagnon produit un journal agrege chaque seconde dans `%LOCALAPPDATA%\VisionHoldClicker\bot.log` avec le nombre de lots, le nombre de clics, la pause maximale et la duree du dernier lot. Les erreurs Windows sont egalement consignees.

### Boucle sans stockage 4.8.0

Le journal 4.7 a montre des lots Windows de 3 a 11 ms mais des interruptions de 0,5 a 3,5 secondes entre les lots. Les lectures `chrome.storage` ont donc ete retirees de la boucle verrouillee. Les compteurs restent en memoire et sont sauvegardes sans attente au maximum une fois par seconde.

### Synchronisation DOM 4.9.0

Le journal suivant a montre jusqu'a 168 clics natifs par seconde pour seulement quelques touches validees : les anciennes coordonnees etaient recliquees avant le deplacement DOM, ce qui saturait la file d'evenements de Chrome. Une cible attend maintenant un changement reel de `data-cell` avant le clic suivant. Un clic perdu est retente apres 100 ms sans bloquer les autres cibles.

## Installation du compagnon Windows (curseur reel)

Gridshot utilise `native-host/VisionMouseHost`, qui deplace physiquement la souris avec `SetCursorPos` et clique avec `SendInput`.

1. Rechargez l'extension dans `chrome://extensions` et copiez son identifiant de 32 lettres.
2. Ouvrez PowerShell dans ce dossier.
3. Executez `powershell -ExecutionPolicy Bypass -File .\install-native-host.ps1 -ExtensionId IDENTIFIANT`.
4. Fermez completement Chrome, puis rouvrez-le.

La desinstallation est reversible avec `powershell -ExecutionPolicy Bypass -File .\uninstall-native-host.ps1`.

## Mode Gridshot

Sur Aim Scientist, les quatre cibles `data-gridshot-target` sont acquises et cliquees automatiquement en leur centre. Selectionnez **Curseur classique**, lancez une partie, puis maintenez **F** (ou utilisez le mode Bascule). Chaque apparition n'est cliquee qu'une fois, puis la cible est immediatement reacquise lorsqu'elle change de position. Chrome affiche un bandeau de debogage pendant les clics natifs ; il disparait a l'arret.

Pendant l'automatisation, l'extension bloque l'acces au service de classement. Le robot peut donc jouer avec un profil local ou public sans publier son score de test.

Extension Chrome Manifest V3 qui surveille directement les modifications de la page avec `MutationObserver`, sans capture d'écran et sans quota. Elle clique sur un contrôle interactif apparu ou modifié tant que la touche configurée reste maintenue. Les minuteurs et comptes à rebours sont ignorés.

Sur `https://aimscientist.com/password#reaction`, la cible exacte `[data-reaction-target]` bénéficie d'une surveillance dédiée via `requestAnimationFrame`, généralement déclenchée dans les 8 à 17 ms suivant son affichage selon la fréquence de l'écran.

Le jeu considère les réactions inférieures à 100 ms comme un faux départ. Le mode dédié impose donc un minimum technique de 100 ms et active la cible avec `HTMLElement.click()`. Les statistiques de l'extension sont écrites hors du chemin critique pour ne pas retarder le clic.

## Installation

1. Ouvrez `chrome://extensions`.
2. Activez **Mode développeur**.
3. Cliquez **Charger l'extension non empaquetée**.
4. Sélectionnez ce dossier `extension`.
5. Ouvrez la popup sur la page à automatiser. Depuis la version 1.0.1, elle initialise aussi les onglets déjà ouverts.

## Utilisation

1. Cliquez sur l'icône de l'extension.
2. Réglez les délais et la sensibilité (88 % est un bon point de départ).
3. Choisissez l'écran visible entier ou, de préférence, sélectionnez la zone où le changement est attendu.
4. Fermez la popup et maintenez **F** sur la page immobile.
5. Le prochain changement du DOM (apparition, texte, classe, style ou visibilité) déclenche un clic sur l'élément modifié.
6. Relâchez **F** pour arrêter immédiatement.

Le mode **Bascule** permet également d'activer avec un premier appui sur F et de désactiver avec un second appui. Le mode **Maintenir** conserve le comportement initial.

Le bouton **Démarrer maintenant / Arrêter** de la popup commande directement le script de la page et sert aussi de diagnostic si les événements clavier ne parviennent pas à la popup.

Sur Aim Scientist, la version 3.3 force automatiquement le curseur classique, demarre Gridshot et bloque le service de classement pendant les clics de test. Le score automatise reste ainsi hors du classement public.

## Limites Chrome

- Cette version surveille le DOM de la page, pas les pixels du bureau Windows.
- Les pages internes (`chrome://...`), le Chrome Web Store et certains PDF protégés n'acceptent pas les scripts d'extension.
- Sur Aim Scientist, les clics sont effectues par le compagnon Windows natif. Sur les autres pages, le mode generique conserve des evenements DOM synthetiques, que certains sites peuvent refuser.
- La touche est suivie lorsque le focus se trouve dans la page. Chrome ne transmet pas les frappes quand la barre d'adresse, la popup ou une autre application a le focus.
- Les changements dessinés uniquement dans un `<canvas>` ou une vidéo ne modifient pas nécessairement le DOM et peuvent ne pas être détectés.

Utilisez l'automatisation uniquement sur des pages et services qui l'autorisent.
