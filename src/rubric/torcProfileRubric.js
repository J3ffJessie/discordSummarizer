// Evaluation rubric based on the "Build a Profile That Gets Noticed" workshop deck
// (randstad digital powered by torc x TAG-Ed). Edit freely; the command reads this at startup.

const RUBRIC_VERSION = '2026-10-workshop-v3';

// The seven checklist items from the deck, expanded with the guidance from the walkthrough slides.
const CRITERIA = [
  {
    id: 'headline',
    name: 'Headline names role and level',
    lookFor:
      'One clear line built as role + specialty + level + one proof point ' +
      '(e.g. "Full-stack engineer · React, Node, Postgres · 5 years" or ' +
      '"Product designer · Design systems & accessibility · 6 years · Led a checkout redesign"). ' +
      'Level means years of experience or scope (e.g. "led a team of 6"), not necessarily a formal title; ' +
      'seniority words like "Senior", "Lead", "Head of" or "Leader" also count. ' +
      'Vague labels like "Passionate developer" fail. For career changers, it should name the role they want.',
  },
  {
    id: 'summary',
    name: 'Summary says what\'s next',
    lookFor:
      'The bio answers three things a recruiter should get in seconds: what they do, where they add value ' +
      '(skills, tools, results tied to real roles), and what\'s next (the kind of role and work arrangement they want). ' +
      'Contains at least one concrete result.',
  },
  {
    id: 'skills',
    name: 'Skills ordered and honest',
    lookFor:
      'Skills are listed and added to each role in the experience history, strongest skills first, ' +
      'and they match what the experience actually shows. No padding with unsupported skills.',
  },
  {
    id: 'experience',
    name: 'Roles show stack and results',
    lookFor:
      'Each role describes the tools, methods or tech stack + what they owned + the result, ideally quantified ' +
      '(e.g. "Owned the deploy pipeline for a Python and AWS payments API and cut release time from 40 to 12 minutes" or ' +
      '"Ran usability testing in Figma and Maze for the onboarding flow and lifted completion from 52% to 71%"). ' +
      'For non-engineering roles, judge the tools and methods they name, not a programming stack. ' +
      'Vague lines like "Worked on backend services" are partial at best.',
  },
  {
    id: 'preferences',
    name: 'Preferences filled in',
    lookFor:
      'Location (where they are and where they can work), target role, availability ' +
      '(full time, part time, open to offers, unavailable), and languages with honest levels. ' +
      'These are personal choices: only the candidate can fill them in.',
  },
  {
    id: 'assessments',
    name: 'Assessments taken where they fit',
    lookFor:
      'Evidence of completed Torc skill assessments or a filled scorecard for their core skills. ' +
      'Often not visible on a public page; mark unverifiable if absent from the content rather than missing.',
  },
  {
    id: 'resume',
    name: 'Current resume attached',
    lookFor:
      'A current resume is attached or linked. Often not visible on a public page; ' +
      'mark unverifiable if the content gives no signal either way.',
  },
];

// Situational guidance from the "pivoting, graduating or returning after a gap?" slide.
const SITUATIONS = {
  career_changer: 'Lead with the role they want, then show the skills and projects that prove it.',
  new_grad: 'Lead with projects, internships and coursework, showing what they built and the result.',
  returning_after_gap: 'Address the gap in one plain line, then show what they built, learned or kept current since.',
};

const RESOURCES = [
  'Ask the team a specific question: email community@torc.dev with your profile link',
  'Assessment invites outside your listed skills: assessments@torc.dev',
  'Live resume reviews and other sessions: torc.dev/events',
];

module.exports = { RUBRIC_VERSION, CRITERIA, SITUATIONS, RESOURCES };
