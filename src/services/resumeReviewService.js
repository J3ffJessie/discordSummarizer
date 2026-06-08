const { createChatProvider, resolveConfig, supportsVision } = require('../providers');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMAGE_MIME_TYPES = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
};

class ResumeReviewService {
  async handleMessage(message, guildConfig) {
    const attachment = message.attachments.first();
    if (!attachment) return;

    const multipleNote = message.attachments.size > 1
      ? '\n\n> Note: multiple attachments were found — only the first was reviewed.'
      : '';

    // Pre-flight: ask for target role before running the review
    // message.channel is already the thread if the channel is thread-based
    const collectorChannel = message.channel;
    await message.reply(
      `What role or position are you targeting with this resume? ` +
      `*(You have 2 minutes to reply — or I'll proceed with a general review.)*`
    );

    let timedOut = false;
    const collector = collectorChannel.createMessageCollector({
      filter: m => m.author.id === message.author.id,
      max: 1,
      time: 120_000,
    });

    const targetRole = await new Promise(resolve => {
      collector.on('collect', m => resolve(m.content.trim()));
      collector.on('end', (collected, reason) => {
        if (reason !== 'limit') {
          timedOut = true;
          resolve('a general professional role');
        }
      });
    });

    if (timedOut) {
      try {
        await message.reply(
          `No response received — proceeding with the review assuming **a general professional role**.`
        );
      } catch { /* ignore secondary failure */ }
    }

    try {
      await message.channel.sendTyping();

      const buffer = await this.downloadAttachment(attachment.url, attachment.size);
      const ext    = this._getExtension(attachment.name || '');

      if (IMAGE_EXTENSIONS.has(ext)) {
        const { provider } = resolveConfig('summ', guildConfig);
        if (!supportsVision(provider)) {
          await message.reply(
            `I can't review image resumes with the current AI provider (\`${provider}\`). ` +
            `Ask a server admin to configure Anthropic or OpenAI via \`/setup ai\`, ` +
            `or resubmit the resume as a PDF, DOCX, or TXT file.`
          );
          return;
        }
        const mimeType   = IMAGE_MIME_TYPES[ext] || 'image/png';
        const reviewText = await this.reviewImage(buffer, mimeType, guildConfig, targetRole);
        await this._sendChunked(message, this._buildPreface() + reviewText + multipleNote);
        return;
      }

      const text = await this.extractText(buffer, attachment.name || '');
      if (!text || text.trim().length < 50) {
        await message.reply(
          `I wasn't able to extract readable text from this file. ` +
          `If this is a scanned PDF, try exporting it as a text-based PDF, or resubmit as DOCX or TXT.`
        );
        return;
      }

      const reviewText = await this.reviewText(text, guildConfig, targetRole);
      await this._sendChunked(message, this._buildPreface() + reviewText + multipleNote);

    } catch (err) {
      console.error('[resume-review] Error:', err.message);
      const userMsg = (err.message?.includes('API key') || err.message?.includes('No API key'))
        ? `Resume review isn't configured — ${err.message}`
        : `There was an error reviewing this resume. Please try again or contact a server admin.`;
      try { await message.reply(userMsg); } catch { /* ignore secondary failure */ }
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

  async reviewText(text, guildConfig, targetRole = 'a general professional role') {
    const provider = createChatProvider('summ', guildConfig);
    const truncated = text.slice(0, 12000);
    return provider.chat(
      this._buildSystemPrompt(targetRole),
      `Here is the resume to review:\n\n${truncated}`,
      { max_tokens: 2048 }
    );
  }

  async reviewImage(buffer, mimeType, guildConfig, targetRole = 'a general professional role') {
    const provider = createChatProvider('summ', guildConfig);
    return provider.chatWithVision(
      this._buildSystemPrompt(targetRole),
      'Please review this resume image.',
      buffer,
      mimeType
    );
  }

  _buildSystemPrompt(targetRole = 'a general professional role') {
    return `You are an expert resume reviewer with deep knowledge of hiring practices, ATS systems, and career coaching. The candidate is targeting: ${targetRole}. Tailor your feedback to this specific role. Review the resume and give structured, actionable feedback covering these 6 sections:

**1. Summary/Objective**
Evaluate clarity, tailoring to a target role, and impact. Note if it's missing or too generic.

**2. Skills**
Assess relevance, specificity, and organization. Flag missing hard skills or overly vague soft skills.

**3. Experience**
Check for strong action verbs, quantified achievements (numbers, percentages, outcomes), and relevance. Flag bullet points that only describe duties without showing impact.

**4. Education**
Review completeness and formatting. Note if certifications or relevant coursework are missing.

**5. Formatting & Length**
Evaluate ATS compatibility (avoid tables, columns, images, headers/footers), readability, and appropriate length (1–2 pages for most roles).

**6. Top 3 Improvements**
List the 3 highest-priority changes the candidate should make, in order of impact.

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

  async _sendChunked(message, text) {
    const MAX_LEN = 1900;
    if (text.length <= MAX_LEN) {
      await message.reply(text);
      return;
    }
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        await message.reply(remaining);
        break;
      }
      let cut = remaining.lastIndexOf('\n', MAX_LEN);
      if (cut < MAX_LEN / 2) cut = MAX_LEN;
      await message.reply(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
  }
}

module.exports = { ResumeReviewService };
