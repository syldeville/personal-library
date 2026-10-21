# Personal Library

A plain, paper-like reader for your own books, documents and manga. It runs in Safari and installs to the iPhone home screen like an app.

- Reads **PDF, EPUB, TXT, Markdown, Word (.docx)**, and manga as **CBZ, CBR, ZIP** or a set of images
- **Remembers your place** in every book, and syncs it between devices through a private GitHub repo
- **Text size, font, line spacing, margins and alignment** for books. PDFs can switch between the original page and resizable text
- **Manga:** right-to-left or left-to-right pages, tap to turn, pinch to zoom, and **MangaDex** search and download
- **Library** in list or grid view, sorted by recently read, title, author, date added or progress, with cover art found online
- Works **offline** once loaded

## 1. Put it online (GitHub Pages)

1. On GitHub, open this repo → **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch (`main`) and the `/ (root)` folder, then **Save**.
3. After a minute the address appears at the top of that page, for example `https://your-name.github.io/personal-library/`.

## 2. Install on iPhone

Open that address in **Safari**, tap **Share**, then **Add to Home Screen**. Always open it from the home screen icon: that copy keeps its own library.

## 3. Sync between devices (optional)

Your reading list and positions are saved in a small `library.json` file in a **private** repo. The book files themselves stay on each device.

1. Create a new **private** repository, for example `library-data`. It can be empty.
2. Create a token: GitHub → your photo → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - **Repository access:** *Only select repositories* → `library-data`
   - **Permissions → Repository permissions → Contents:** *Read and write*
   - Pick an expiry you're comfortable with. When it expires, make a new one and paste it in again.
3. In the app: **☰ → Settings → Sync with GitHub**. Enter `your-name/library-data` and the token, then tap **Save & sync**. Do the same on each device.

A book added on one device shows on the others as "Not on this device". Tap it and pick the same file to carry on where you left off.

## 4. MangaDex (optional)

MangaDex needs a tiny free proxy. Follow [proxy/README.md](proxy/README.md) (about five minutes), then paste its address into **Settings → MangaDex**.

## Notes

- Covers are looked up on Open Library and Google Books (books) and AniList (manga). Use **⋯ → Change cover** to pick another, or choose your own image.
- iOS can clear a web app's storage if it goes unused for weeks. Sync, or **Settings → Export backup file**, keeps your places safe. Book files would need importing again.
- Libraries used, all bundled so they work offline: [PDF.js](https://mozilla.github.io/pdf.js/), [epub.js](https://github.com/futurepress/epub.js), [JSZip](https://stuk.github.io/jszip/), [mammoth](https://github.com/mwilliamson/mammoth.js), [marked](https://marked.js.org/), [libarchive.js](https://github.com/nika-begiashvili/libarchivejs), and the [Literata](https://github.com/googlefonts/literata) font.

## Changing the code

It's plain HTML, CSS and JavaScript with no build step. After changing any file, run

```sh
node tools/stamp-sw.mjs
```

so installed copies pick up the new version. To try it locally, run `npx http-server` in this folder and open `http://localhost:8080`.
