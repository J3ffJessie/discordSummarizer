# Changelog

## [2.3.0] - 2026-10-17

### New Feature - Junior-level resume review

`/resume-review` has a new optional `level` choice: **Junior / early-career** or **Experienced**. Junior resumes are judged on potential instead of years of experience. Internships, volunteering, and personal projects count as experience, quantified results are a bonus rather than a requirement, Education is treated as a core section, skills should be backed by a project or course, and length is strictly 1 page. Leaving `level` blank or choosing Experienced keeps the existing review criteria. Applies to both text and image resumes.

### New Feature - Torc profile review

New `/torc-review` command reviews a member's torc.dev profile against the profile workshop rubric and DMs a scorecard with step-by-step fixes. Nothing is stored.

### Changed - Resume review is command based

Resume review now runs through the `/resume-review` slash command instead of the forum channel, so members can get feedback privately by DM without posting their resume in Discord.

## [2.2.0] - 2026-10-17

### New Feature - Duck Hunt

Duck Hunt is now playable right inside Discord. Run `/duckhunt play` (or open the App Launcher with the rocket button in a voice or text channel) to launch the game as a Discord Activity. Aim with your mouse and click to shoot, or use the arrow keys/WASD to aim and Space to shoot. Each wave has two ducks and three shells, and you need to hit enough ducks each round to advance. Faster, rarer ducks are worth more points, and hitting all 10 ducks in a round earns a perfect bonus. It also works on mobile with touch.

Scores are saved per server. Use `/duckhunt leaderboard` to see the top 10 hunters in your server. No setup is needed from server admins.
