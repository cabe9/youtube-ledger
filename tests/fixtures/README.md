# Upload feed fixture

`youtube-uploads.xml` is a public YouTube Atom feed response for channel
`UCvryaJCRHcTVjOC_DcuYxGg`, captured on September 5, 2026. It covers channel
identity, publication timestamps, older uploads, and public view counts.
It contains no account cookies, group memberships, or viewing history. Tests
read this local file without contacting YouTube.

Video descriptions are omitted; parser-relevant fields retain their public values.

`uploads-page-*.json` contains trimmed public uploads-list response excerpts for CarlSagan42, いろいろな日本語, and Yuri Shizu, captured September 10, 2026 (UTC). Only parser-relevant identity, title, age, count, duration and navigation fields remain. Tracking parameters, playback URLs, images and menus are removed. No live request is made by tests.
