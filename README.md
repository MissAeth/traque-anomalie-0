# Traque : Anomalie 0 — système Foundry VTT

Jeu de rôle horrifique en narration partagée pour 3 à 5 joueurs, sans dé. Compatible Foundry VTT v13 et v14.

## Installation
Dans Foundry : **Systèmes de jeu › Installer un système**, puis coller cette URL dans « URL du manifeste » :

```
https://raw.githubusercontent.com/MissAeth/traque-anomalie-0/main/system.json
```

Installation manuelle : télécharger [`dist/traque-anomalie-0.zip`](https://raw.githubusercontent.com/MissAeth/traque-anomalie-0/main/dist/traque-anomalie-0.zip) et le décompresser dans `Data/systems/` (le dossier doit s'appeler `traque-anomalie-0`).

## Contenu
- **Feuille de survie** : Prénom, Objet fétiche (case « détruit »), trois coches de Souffle. Les trois noircies : le personnage devient un Spectre.
- **Pioche par actes** : Mise en place, Actes I à III (mélangés), Épilogue. Règles 3 / 4 / 5 joueurs et choix des participants au lancement.
- **Choix automatisés** : les coûts des cartes s'appliquent d'un clic sur la fiche (Souffle, objet fétiche, alliés).
- **SAS** : la pioche est bloquée quelques minutes après chaque carte pour laisser la table réagir (durée réglable).
- **Fin de partie** : bilan des rescapés et des Spectres dans le chat.

## Jouer
1. Créer un acteur « Personnage » par joueur et l'assigner au joueur.
2. Ouvrir le panneau de pioche (bouton « Pioche de la traque » dans l'onglet Acteurs).
3. Le MJ clique sur **Nouvelle partie…**, choisit le nombre de joueurs et les participants.

Un utilisateur Gamemaster doit être connecté : c'est lui qui tient le paquet (il peut jouer un personnage comme les autres).

## Modifier les cartes
Tous les textes sont dans `data/cartes.json`. Types d'effets : `souffle`, `objet`, `tous`, `cible`, `allieSouffle`, `allieObjet`.

## Publier une nouvelle version
1. Augmenter `version` dans `system.json`.
2. Reconstruire `dist/traque-anomalie-0.zip` (fichiers du système à la racine du zip, sans `dist/` ni `.git/`).
3. Pousser sur `main` : Foundry proposera la mise à jour.
