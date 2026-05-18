# Changelog

## [1.2.1] - 2026-05-18

### Fix
- Fixed an issue with chunk size for server summarization as it was pushing past the token limit for provider. Also made changes to server summary prompt to be more concise and utilize less tokens on the prompt to get a more user friendly summarization and more readable output that is more accurate to the summarization.