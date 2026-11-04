// Public API of modules/gifs [S2]: GIF search in the sticker panel through the server (#139). No
// tables: searches go to the operator's provider (config `gifs`); a placed GIF becomes an ordinary
// upload of the person who placed it (modules/uploads, through unfurl's safe fetch). Nothing else
// calls into it today.
export {};
