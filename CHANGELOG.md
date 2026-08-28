# Changelog

## [2.0.12] - 2026-08-13

### Bug Fix - Interview Starting before user joins
- Added delay logic to wait for user to join voice channel before interview begins. Previous iteration was skipping past the validation step of user joining and was recognizing the embed of the voice channel as sufficient. Now the interview will not start until the user has successfully joined the private voice channel.