# Changelog

## [2.2.0] - 2026-10-05

### New Feature - Junior-level resume review

`/resume-review` has a new optional `level` choice: **Junior / early-career** or **Experienced**. Junior resumes are judged on potential instead of years of experience. Internships, volunteering, and personal projects count as experience, quantified results are a bonus rather than a requirement, Education is treated as a core section, skills should be backed by a project or course, and length is strictly 1 page. Leaving `level` blank or choosing Experienced keeps the existing review criteria. Applies to both text and image resumes.

### New Feature - Torc profile review

New `/torc-review` command reviews a member's torc.dev profile against the profile workshop rubric and DMs a scorecard with step-by-step fixes. Nothing is stored.

### Changed - Resume review is command based

Resume review now runs through the `/resume-review` slash command instead of the forum channel, so members can get feedback privately by DM without posting their resume in Discord.

## [2.1.0] - 2026-09-14

### New Feature - LeetCode interview

Leetcode style interview now available for interview practice. Selectable at interview type, only supporting the following languages currently (JavaScript, Python, Java, C++). Users join the voice call and are prompted in the voice channel chat with the scenario and the formatting of the prompt. Users can run their code against the tests 2 times before they must submit. There are only 3 questions for the leetcode style interviews to keep the time of interview consistent with real world style interviews. After each code submission, the user is then asked to explain their decision making just like a real interview.