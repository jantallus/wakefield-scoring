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

## Deux portraits pour comprendre

**Celui qui gagne : l'ouvreur.** Il choisit sa ligne au lieu d'attendre celle des autres. Il trouve une bonne partie de ses thermiques lui-même et les quitte avant le gaggle. En transition, il n'a personne devant lui pour lui montrer où ça monte. Qu'il soit bas devant (le courage) ou haut devant (l'efficacité en thermique), son chrono tourne au ralenti pendant de longues phases. Il peut franchir l'ESS dans le paquet, quelques secondes après d'autres, et gagner quand même.

**Celui qui perd du temps sans le voir : le suiveur.** Il vole bien, ne fait pas d'erreur et reste au contact du groupe de tête. Mais il n'ouvre jamais : il enroule les thermiques que d'autres ont marqués et part en transition quand le groupe part. Son chrono tourne en temps réel du start à l'arrivée. Avec le leading actuel, il marque presque autant que les leaders ; avec Wakefield, il recule.

**Sur une vraie manche** (PWC Gemona 2026, manche 3, une course en gaggle) :

| | L'ouvreur (vainqueur) | Un suiveur |
| --- | --- | --- |
| Arrivée à l'ESS | 15ᵉ | 18 s plus tard, 25ᵉ |
| Temps passé parmi les 10 premiers de la course | 77 min | 2 min |
| Part du vol sans aide | 46 % | 0 % |
| Thermiques enroulés sans personne pour les marquer | 43 % | 0 % |
| Crédit de temps | 10,2 min | 2,2 min |
| Classement Wakefield | **1ᵉʳ** | 37ᵉ |

Le crédit est borné (ici 17,7 min au plus) : un pilote autonome mais trop lent ne peut pas passer devant un pilote rapide. Wakefield ne récompense pas l'isolement, il récompense l'initiative qui fait avancer.

## Le calcul

Les formules et les paramètres sont détaillés dans le [README en anglais](README.md#how-it-is-computed). En résumé :

- **Le champ** additionne les autres pilotes et leurs traces des dernières minutes, dans un cône orienté vers l'avant, pondéré par l'angle de vue (un gaggle à ta verticale ne t'aide pas) et par le fait qu'ils montaient.
- **La remontée** : si tu vas plus vite que ceux qui te montrent le chemin, la différence est à toi. Un pilote qui remonte à 30 km/h derrière un gaggle qui avance à 20 km/h voit un tiers de sa progression comptée comme autonome ; un suiveur au rythme du gaggle ne gagne rien. Une erreur en début de manche ne coûte donc que le temps perdu.
- **L'horloge** : `dτ/dt = 1 − ε · (1 − g) · v_prog / v_ref`. Le crédit est borné à ε × distance / v_ref, donc un pilote lent ne peut pas gagner plus d'avance qu'un pilote rapide.
- **Le but.** Le chrono s'arrête à l'ESS, pour que personne ne fasse la course à pleine vitesse jusqu'au sol, mais la mission n'est accomplie qu'au but. Un pilote arrivé à l'ESS sans atteindre le but en vol est classé comme un posé juste avant le but.
- **Les pilotes posés** passent toujours derrière tous les pilotes au but. Leur distance corrigée (distance + ε × km autonomes, plafonnée à la distance de la manche, la distance réelle départageant les égalités) est convertie en temps estimé : durée jusqu'à la deadline + distance manquante / v_ref.

## Premiers résultats : PWC Gemona 2026, manches 2 et 3

Le classement final reste très proche du classement officiel (même vainqueur, corrélation de rang de 0,96 à 0,97), mais le crédit Wakefield suit beaucoup mieux que le leading GAP le temps passé en tête de course : 0,86 contre 0,65 en manche 2, et 0,80 contre 0,41 en manche 3, une course en gaggle.

Les replays animés sont dans [`replays/`](replays/).

## L'application

[`app/`](app/) est une application dans le navigateur : on y charge la manche (QR code XCTrack ou `.xctsk`), les traces IGC (zip) et, en option, le classement officiel, puis on règle chaque paramètre avec des curseurs. Elle affiche le replay animé, le leaderboard en direct et le classement final. Tout le calcul reste sur l'ordinateur. En ligne : **https://jantallus.github.io/wakefield-scoring/app/** (une fois GitHub Pages activé).

## Contribuer

Les idées, les critiques et le code sont les bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md). Les issues peuvent être écrites en français ou en anglais.

## Licence

[MIT](LICENSE)
