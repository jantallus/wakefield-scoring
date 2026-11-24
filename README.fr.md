# Wakefield

**Une idée de scoring pour les courses de parapente : un chrono par pilote, qui ralentit quand le pilote vole de sa propre initiative et tourne en temps réel quand il s'aide des autres.**

*[English version](README.md)*

## L'idée

Dans le scoring actuel des courses au but, les points de leading viennent de la surface sous la courbe distance/temps de chaque pilote. Ça récompense le fait d'être devant, pas le fait de voler sans aide. Un pilote qui reste toujours juste derrière le groupe de tête, sans erreur, en suivant le bon leader, peut finir avec plus de leading qu'un pilote qui prend des initiatives, passe devant, se retrouve parfois derrière et doit rattraper.

Wakefield remplace les points de leading et les points de temps par un seul chrono :

- Les autres pilotes créent autour d'eux un **champ**, comme un champ gravitationnel : plus tu vois de pilotes utiles devant toi, plus il est fort.
- Ton chrono tourne **en temps réel** quand tu es dans un gaggle ou dans un sillage, et **ralentit** quand tu progresses sur le parcours sans aide.
- **Le classement final est un temps** : les spectateurs suivent un leaderboard en direct qui se reclasse au fil des chronos.

Être bas et devant est récompensé (le courage), être haut et devant aussi (l'efficacité en thermique) : ce qui compte, c'est de ne pas utiliser les autres.

## Le calcul

Les formules et les paramètres sont détaillés dans le [README en anglais](README.md#how-it-is-computed). En résumé :

- **Le champ** additionne les autres pilotes et leurs traces des dernières minutes, dans un cône orienté vers l'avant, pondéré par l'angle de vue (un gaggle à ta verticale ne t'aide pas) et par le fait qu'ils montaient.
- **L'horloge** : `dτ/dt = 1 − ε · (1 − g) · v_prog / v_ref`. Le crédit est borné à ε × distance / v_ref, donc un pilote lent ne peut pas gagner plus d'avance qu'un pilote rapide.
- **Les pilotes posés** passent toujours derrière tous les pilotes à l'ESS. Leur distance corrigée (distance + ε × km autonomes, plafonnée à la distance de la manche, la distance réelle départageant les égalités) est convertie en temps estimé : durée jusqu'à la deadline + distance manquante / v_ref.

## Premiers résultats : PWC Gemona 2026, manches 2 et 3

Le classement final reste très proche du classement officiel (même vainqueur, corrélation de rang de 0,96 à 0,97), mais le crédit Wakefield suit beaucoup mieux que le leading GAP le temps passé en tête de course : 0,86 contre 0,65 en manche 2, et 0,80 contre 0,41 en manche 3, une course en gaggle.

Les replays animés sont dans [`replays/`](replays/).

## Contribuer

Les idées, les critiques et le code sont les bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md). Les issues peuvent être écrites en français ou en anglais.

## Licence

[MIT](LICENSE)
