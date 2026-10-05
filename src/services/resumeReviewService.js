const { createChatProvider, resolveConfig, supportsVision } = require('../providers');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const TEXT_EXTENSIONS  = new Set(['.pdf', '.docx', '.txt']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMAGE_MIME_TYPES = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

const DEFAULT_ROLE = 'a general professional role';

/** Error whose message is safe to show directly to the user. */
class ResumeReviewError extends Error {}

class ResumeReviewService {
  /**
   * Downloads and reviews a resume attachment. Returns the full review text
   * (preface included). Throws ResumeReviewError for user-facing failures.
   */
  async review({ url, size, filename = '', guildConfig, targetRole = DEFAULT_ROLE, level = null }) {
    const ext = this._getExtension(filename);
    if (!TEXT_EXTENSIONS.has(ext) && !IMAGE_EXTENSIONS.has(ext)) {
      throw new ResumeReviewError(
        'Unsupported file type. Please upload a PDF, DOCX, TXT, or image (PNG, JPG, GIF, WEBP).'
      );
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      const { provider } = resolveConfig('summ', guildConfig);
      if (!supportsVision(provider)) {
        throw new ResumeReviewError(
          `I can't review image resumes with the current AI provider (\`${provider}\`). ` +
          `Ask a server admin to configure Anthropic or OpenAI via \`/setup ai\`, ` +
          `or resubmit the resume as a PDF, DOCX, or TXT file.`
        );
      }
    }

    try {
      const buffer = await this.downloadAttachment(url, size);

      if (IMAGE_EXTENSIONS.has(ext)) {
        const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';
        return this._buildPreface() + await this.reviewImage(buffer, mimeType, guildConfig, targetRole, level);
      }

      const text = await this.extractText(buffer, filename);
      if (!text || text.trim().length < 50) {
        throw new ResumeReviewError(
          `I wasn't able to extract readable text from this file. ` +
          `If this is a scanned PDF, try exporting it as a text-based PDF, or resubmit as DOCX or TXT.`
        );
      }

      return this._buildPreface() + await this.reviewText(text, guildConfig, targetRole, level);
    } catch (err) {
      if (err instanceof ResumeReviewError) throw err;
      if (err.message?.includes('too large')) throw new ResumeReviewError(err.message);
      if (err.message?.includes('API key')) {
        throw new ResumeReviewError(`Resume review isn't configured — ${err.message}`);
      }
      if (err.status === 404) {
        const { model } = resolveConfig('summ', guildConfig);
        throw new ResumeReviewError(
          `The AI model configured for this server (\`${model}\`) is unavailable or has been retired. ` +
          `Ask a server admin to choose a current model via \`/setup ai\`.`
        );
      }
      throw err;
    }
  }

  async downloadAttachment(url, size) {
    if (size && size > MAX_FILE_SIZE) throw new Error('File too large (max 10 MB).');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download attachment: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_SIZE) throw new Error('File too large (max 10 MB).');
    return buf;
  }

  async extractText(buffer, filename) {
    const ext = this._getExtension(filename);

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    return buffer.toString('utf8');
  }

  async reviewText(text, guildConfig, targetRole = DEFAULT_ROLE, level = null) {
    const provider = createChatProvider('summ', guildConfig);
    const truncated = text.slice(0, 12000);
    return provider.chat(
      this._buildSystemPrompt(targetRole, level),
      `Here is the resume to review:\n\n${truncated}`,
      { max_tokens: 2048 }
    );
  }

  async reviewImage(buffer, mimeType, guildConfig, targetRole = DEFAULT_ROLE, level = null) {
    const provider = createChatProvider('summ', guildConfig);
    return provider.chatWithVision(
      this._buildSystemPrompt(targetRole, level),
      'Please review this resume image.',
      buffer,
      mimeType
    );
  }

  _buildSystemPrompt(targetRole = DEFAULT_ROLE, level = null) {
    const junior = level === 'junior';
    const levelNote = junior
      ? ` The candidate is junior / early-career, so judge them on potential and evidence of ability rather than years of experience. Do not penalize a short or non-traditional work history.`
      : '';

    const experience = junior
      ? `**3. Experience & Projects**
Count internships, part-time jobs, volunteering, and personal/academic/open-source projects as valid experience. Check for strong action verbs and a clear description of what the candidate built or did. For projects, look for the tech stack, what was built, and a link to the repo or live demo. Quantified results are a bonus, not a requirement, so suggest them only where they plausibly exist (users, performance, scope). Flag bullet points that only list duties or vague tasks.`
      : `**3. Experience**
Check for strong action verbs, quantified achievements (numbers, percentages, outcomes), and relevance. Flag bullet points that only describe duties without showing impact.`;

    const education = junior
      ? `**4. Education**
Education is a core section for this candidate and should appear near the top. Check for degree, school, and graduation date, plus relevant coursework, bootcamps, certifications, honors, and GPA (only if 3.5 or higher). Flag anything relevant that is missing.`
      : `**4. Education**
Review completeness and formatting. Note if certifications or relevant coursework are missing.`;

    const length = junior
      ? 'appropriate length (strictly 1 page)'
      : 'appropriate length (1–2 pages for most roles)';

    return `You are an expert resume reviewer with deep knowledge of hiring practices, ATS systems, and career coaching. The candidate is targeting: ${targetRole}. Tailor your feedback to this specific role.${levelNote} Review the resume and give structured, actionable feedback covering these 6 sections:

**1. Summary/Objective**
Evaluate clarity, tailoring to a target role, and impact. Note if it's missing or too generic. Ensure that the Summary is in bullet format.

**2. Skills**
Assess relevance, specificity, and organization. Flag missing hard skills or overly vague soft skills. Do not suggest soft skills be listed in the skills section.${junior ? ' Skills should be backed up by a project, course, or job elsewhere on the resume.' : ''}

${experience}

${education}

**5. Formatting & Length**
Evaluate ATS compatibility (avoid tables, columns, images, headers/footers), readability, and ${length}.

**6. Top 3 Improvements**
List the 3 highest-priority changes the candidate should make, in order of impact.${junior ? ' Prioritize changes that better demonstrate ability and potential.' : ''}

Be direct, specific, and constructive. Reference specific sections or bullet points when possible.`;
  }

  _getExtension(filename) {
    const lower = filename.toLowerCase();
    const idx   = lower.lastIndexOf('.');
    return idx >= 0 ? lower.slice(idx) : '';
  }

  _buildPreface() {
    return `> **Note:** This is an auto generated review from the AI Bot in this server. These suggestions are to be taken into consideration to make adjustments to your resume based on feedback from recruiters and resume reviewers.\n\n`;
  }

  /** Splits text into Discord-sized chunks, preferring line breaks. */
  _chunk(text, maxLen = 1900) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let cut = remaining.lastIndexOf('\n', maxLen);
      if (cut < maxLen / 2) cut = maxLen;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
  }

  async sendToUser(user, text) {
    for (const chunk of this._chunk(text)) {
      await user.send(chunk);
    }
  }
}

module.exports = { ResumeReviewService, ResumeReviewError, DEFAULT_ROLE, MAX_FILE_SIZE };
