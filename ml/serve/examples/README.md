# Synthetic response examples

Every example in this directory is fabricated for tests and documentation.
`normal.json` contains synthetic baseline coordinates, not actual sign motion.
`unknown.json` is the existing all-unknown coordinate response.

`video.json` is a **legacy filename retained to avoid deleting an existing file**.
Its contents are now a synthetic generation error for HTTP 503:
`error.code=GENERATION_UNAVAILABLE`, a safe message, and `retryable=true`.
It is not a video response, must not be presented as successful generation, and
contains no playback items or URLs. New consumers should identify it by the error
envelope, not infer behavior from its old filename.

The generation API never automatically switches to videos. Existing `/translate`
still provides its original playback items independently.
