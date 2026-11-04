# Médias des clubs

Un dossier par club. Les noms de fichiers sont fixes : le site les cherche
exactement sous ces noms (voir `data-media` dans `index.html`). Tant qu'un
fichier manque, son placeholder reste affiché.

| Emplacement | Fichier | Contenu |
|---|---|---|
| Galerie 1 | `<club>-photo-1.jpg` | photo |
| Galerie 2 | `<club>-photo-2.jpg` | photo |
| Galerie 3 | `<club>-photo-3.jpg` | photo |
| Galerie 4 | `<club>-video-1.mp4` | vidéo courte |
| Plein écran | `<club>-cover.mp4` **ou** `<club>-cover.jpg` | la vidéo est prise si elle existe, sinon la photo |

`<club>` = `newells`, `barca`, `psg`, `miami`, `argentine`.

## Formats conseillés

- **Photos galerie** : JPG, 1200 × 720 px environ (format paysage 5:3), < 300 Ko.
- **Photo plein écran** : JPG, 1920 × 1080 px, < 600 Ko.
- **Vidéos** : MP4 (H.264), **5 à 10 s**, **sans piste son**, pensées pour tourner en boucle
  (fin raccord avec le début), 1280 × 720 px pour la galerie et 1920 × 1080 px pour
  le plein écran, < 4 Mo chacune.
  Exemple avec ffmpeg :
  `ffmpeg -i source.mp4 -ss 00:00:12 -t 8 -an -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow -movflags +faststart barca-video-1.mp4`

Les médias ne sont téléchargés qu'à l'approche de leur club, et les vidéos ne
sont lues que quand le club est à l'écran (sans son, en boucle).
