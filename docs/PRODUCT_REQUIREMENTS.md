# Product Requirements Document: Agentic Resume Builder

## 1. Product Vision

Build a chat-first resume builder that helps a user represent their real experience for a specific job and company. The product is not a generic resume editor. It is a career memory agent that learns the user's professional background, then creates tailored resumes for target opportunities.

The agent should be useful, critical, and principled. It should ask for missing information, challenge weak claims, avoid fabrication, and explain its resume strategy before producing final output.

## 2. Core Principles

- Truth first: never invent companies, roles, achievements, metrics, tools, or responsibilities.
- Memory separation: long-term user memory is updated only in the dedicated memory chat.
- Session separation: each resume chat is target-specific and should not automatically modify long-term memory.
- Structured output: AI should produce structured resume data, not directly control PDF layout.
- User control: the user can review, edit, approve, reject, and export.
- Simple architecture: use React, Node.js, SQLite, and OpenRouter with clear responsibilities.

## 3. Target Users

Primary user:
- A professional applying to jobs who wants each resume adapted to the company and role.

Initial assumed niche:
- Software engineers, technical founders, product-minded builders, and knowledge workers.

Future users:
- Students, career switchers, executives, freelancers, and recruiters.

## 4. Product Scope

### MVP Includes

- Dedicated memory chat with selected agent personality.
- Structured career memory created from chat.
- Ability to view and edit saved memory.
- Resume chat sessions for individual job opportunities.
- Job description and company information input.
- AI-generated fit analysis and resume strategy.
- AI-generated tailored resume draft based on saved memory.
- Conversational resume revision loop.
- PDF export using deterministic templates.
- Multiple ATS-friendly resume formats.

### MVP Excludes

- Public user accounts.
- Team collaboration.
- Full drag-and-drop resume designer.
- Automated job board application.
- Browser extension.
- Payment system.
- Multi-language resume generation.
- DOCX export.

## 5. Main User Workflows

### 5.1 Memory Setup Workflow

1. User chooses or creates an agent personality.
2. User enters the dedicated memory chat.
3. Agent interviews the user about experience, projects, skills, achievements, education, goals, constraints, and preferences.
4. Agent extracts structured memory items.
5. Agent asks the user to confirm important facts before saving.
6. Saved memory becomes available to future resume sessions.

Expected behavior:
- The agent should ask follow-up questions when facts are vague.
- The agent should label weak or unverified memories.
- The agent should preserve source context from the conversation.
- The agent should not save sensitive or questionable information without confirmation.

### 5.2 Resume Builder Workflow

1. User creates a new resume chat.
2. User provides job description, company name, and optional company context.
3. Agent analyzes job requirements, company signals, and hiring intent.
4. Agent compares the opportunity against saved user memory.
5. Agent asks for missing information only when needed.
6. Agent proposes a resume strategy.
7. Agent creates a tailored resume draft.
8. User gives feedback in chat.
9. Agent revises the structured resume.
10. User exports the resume as PDF.

Expected behavior:
- The agent should explain what it emphasized and why.
- The agent should identify missing signals or weak evidence.
- The agent should keep a clear boundary between real experience and recommended positioning.
- The agent should allow multiple resume versions per job session.

### 5.3 Export Workflow

1. User selects a resume template.
2. User selects one-page or two-page mode when supported.
3. System renders the structured resume into previewable format.
4. User exports PDF.

Expected behavior:
- PDF layout should be consistent and deterministic.
- Templates should be ATS-friendly by default.
- The AI should not directly generate visual layout code per resume.

## 6. Agent Personality

The product should allow users to select an agent personality. Personality affects interaction style, critique style, and coaching style. It must not change factual standards.

Examples:
- Strategic minimalist: concise, direct, outcome-focused.
- Critical mentor: skeptical, asks hard questions, challenges weak claims.
- Startup advisor: values traction, ownership, shipping, and business impact.
- Executive coach: polished, leadership-oriented, positioning-focused.
- Technical interviewer: precise, evidence-driven, implementation-aware.

Personality configuration should include:
- Name
- Description
- Tone
- Critique intensity
- Preferred reasoning style
- Resume writing bias

Guardrail:
- Personality must not encourage exaggeration, fabrication, or manipulative claims.

## 7. Functional Requirements

### 7.1 Memory Chat

- User can open a special memory chat.
- User can talk with the selected agent.
- Agent can extract candidate memory updates.
- System asks for confirmation before writing important long-term memory.
- User can accept, reject, or edit memory updates.
- User can view saved memory by category.
- User can manually edit or delete memory.

Memory categories:
- Profile summary
- Work experience
- Projects
- Skills
- Education
- Certifications
- Achievements
- Career goals
- Role preferences
- Company preferences
- Constraints
- Writing preferences
- Sensitive exclusions

### 7.2 Resume Sessions

- User can create a new resume chat.
- User can add job title, company name, job description, location, and notes.
- Agent can analyze job requirements.
- Agent can retrieve relevant memory.
- Agent can produce a fit analysis.
- Agent can generate a tailored resume draft.
- Agent can revise resume draft based on feedback.
- User can save multiple versions.
- User can mark one version as final.

### 7.3 Resume Templates

- System includes several PDF templates.
- Templates render structured resume content.
- Templates support consistent typography, spacing, and section ordering.
- User can preview before export.

Initial templates:
- Classic ATS
- Technical Compact
- Modern Professional

### 7.4 AI Integration

- Use OpenRouter as the AI API provider.
- Store OpenRouter API key in server environment variables.
- Node.js backend owns all AI requests.
- Frontend never receives the API key.
- Prompts should request structured JSON when writing memory or resume data.
- Validate AI outputs before saving.

AI tasks:
- Conversation response
- Memory extraction
- Job description analysis
- Resume strategy generation
- Resume draft generation
- Resume revision

## 8. Non-Functional Requirements

- Keep the system simple and maintainable.
- Favor OOP service classes on the backend where responsibilities are clear.
- Use SQLite for local-first persistence.
- Avoid unnecessary files and layers.
- Keep generated resume data auditable.
- Do not block the UI during AI requests.
- Protect API keys and user data.
- Design for future migration to hosted SaaS, but do not overbuild the MVP.

## 9. Suggested Architecture

### Frontend

Technology:
- React
- Vite
- CSS or lightweight component styling

Responsibilities:
- Chat interface
- Memory review UI
- Resume session UI
- Resume preview UI
- Template selection
- Export controls

Suggested major views:
- Memory Chat
- Memory Profile
- Resume Chats
- Resume Draft
- Export Preview
- Settings

### Backend

Technology:
- Node.js
- Express
- SQLite
- OpenRouter API

Responsibilities:
- Chat session management
- Memory persistence
- AI orchestration
- Resume version management
- Template rendering pipeline
- PDF export

Suggested service classes:
- `OpenRouterService`
- `MemoryService`
- `ChatService`
- `ResumeService`
- `JobAnalysisService`
- `ExportService`
- `TemplateService`

### Database

Technology:
- SQLite

Core tables:
- `agent_personalities`
- `memory_chats`
- `memory_messages`
- `memory_items`
- `resume_sessions`
- `resume_messages`
- `job_targets`
- `job_analyses`
- `resume_versions`
- `resume_templates`
- `exports`

## 10. Data Model Draft

### Memory Item

```json
{
  "id": "memory_123",
  "category": "work_experience",
  "title": "Backend API performance work",
  "content": "Improved API response time by optimizing database queries.",
  "confidence": "confirmed",
  "sourceMessageId": "msg_123",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T00:00:00.000Z"
}
```

### Job Target

```json
{
  "id": "job_123",
  "companyName": "Example Corp",
  "jobTitle": "Backend Engineer",
  "jobDescription": "Full pasted job description...",
  "companyNotes": "B2B SaaS company focused on infrastructure.",
  "createdAt": "2026-06-08T00:00:00.000Z"
}
```

### Resume Version

```json
{
  "id": "resume_123",
  "sessionId": "session_123",
  "versionNumber": 1,
  "templateId": "classic_ats",
  "content": {
    "headline": "",
    "summary": "",
    "skills": [],
    "experience": [],
    "projects": [],
    "education": []
  },
  "strategy": {
    "positioning": "",
    "emphasizedEvidence": [],
    "reducedEvidence": [],
    "missingSignals": []
  }
}
```

## 11. AI Guardrails

- The agent must not fabricate facts.
- The agent must mark uncertain claims as questions or suggestions.
- The agent must not silently save memory from normal resume chats.
- The agent must ask confirmation before saving long-term memory.
- The agent must separate "known user fact" from "recommended resume wording."
- The agent should prefer measurable achievements, but must not invent metrics.
- The agent should avoid keyword stuffing.
- The agent should keep resumes concise and relevant.

## 12. OpenRouter Prompting Strategy

Use separate prompts for separate responsibilities.

Recommended prompt types:
- Memory interview prompt
- Memory extraction prompt
- Job analysis prompt
- Fit analysis prompt
- Resume generation prompt
- Resume revision prompt

Each prompt should have:
- Role
- Inputs
- Rules
- Output schema
- Refusal or uncertainty behavior

Critical rule:
- Do not use one giant prompt for every task. Keep AI tasks small, testable, and easier to debug.

## 13. Success Metrics

MVP success:
- User can create confirmed memory through chat.
- User can generate a tailored resume from a job description.
- User can revise resume through chat.
- User can export a clean PDF.
- Generated resume contains no unsupported claims.

Quality metrics:
- Time from job description paste to first draft.
- Number of user edits needed before export.
- User rating of job fit.
- Percentage of resume bullets traceable to memory.
- PDF export success rate.

## 14. Risks

### Memory Pollution

Risk:
- Agent saves temporary, inaccurate, or job-specific statements as permanent user facts.

Mitigation:
- Only memory chat can update long-term memory.
- Require confirmation for important memory writes.

### Fabrication

Risk:
- Agent invents achievements or metrics to improve resume fit.

Mitigation:
- Strict prompting.
- Structured memory retrieval.
- Traceability from resume claims to memory items.
- UI warnings for unsupported claims.

### Personality Distraction

Risk:
- Personality system becomes more important than resume quality.

Mitigation:
- Personality changes communication style, not factual rules.
- Keep resume quality guardrails universal.

### Template Complexity

Risk:
- PDF templates become fragile if AI controls layout.

Mitigation:
- AI outputs structured data.
- Code renders templates deterministically.

## 15. Recommended MVP Milestones

### Milestone 1: Foundation

- SQLite schema
- Basic React app shell
- Backend API structure
- OpenRouter service
- Basic chat persistence

### Milestone 2: Memory Agent

- Memory chat
- Memory extraction
- Confirmation flow
- Memory profile view

### Milestone 3: Resume Session

- Job target input
- Job analysis
- Fit strategy
- Resume draft generation
- Revision loop

### Milestone 4: Export

- Structured resume preview
- Template selection
- PDF generation
- Export history

### Milestone 5: Quality Layer

- Unsupported claim detection
- Memory traceability
- Template polish
- Prompt testing

## 16. Open Questions

- Should this be local-only at first, or prepared for multi-user accounts?
- Should users bring their own OpenRouter API key, or should the app owner provide one?
- Should the memory agent support file uploads, such as old resumes and LinkedIn exports?
- Should resume templates prioritize one-page resumes only in MVP?
- Should the agent produce cover letters later?
- Should personality presets be user-editable?

## 17. First-Principles Product Thesis

A resume is not a document problem first. It is a representation problem.

The user has a large body of real experience. A job description is a narrow demand signal. The product's job is to create the best truthful mapping between those two things.

Therefore, the most important product asset is not the PDF template. It is structured, trusted user memory. The second most important asset is job-specific reasoning. The PDF is the final presentation layer.

