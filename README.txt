1AWS.net website files
======================

Upload everything in this folder (not the folder itself) to the root of your hosting.

Cloudflare Pages (free):
1. Cloudflare dashboard > Workers & Pages > Create > Pages > Upload assets.
2. Drag in all the files from this folder and deploy.
3. In the project's Custom domains tab, add 1aws.net.

Adding a news story:
Open news.html, find the comment that says NEWS ITEMS, copy one <article> block,
paste it above the others and change the date, headline, text and sources.
Also update the "Latest security news" block near the bottom of index.html.

The contact form opens the visitor's email app with the message filled in,
addressed to contact@1aws.net. No server or form service is needed.
