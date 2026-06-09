import { db, type Statement } from '../database/connection.ts';
import type { ResumeMessage, ResumeSession, ResumeVersion } from '../../shared/types.ts';

// Raw DB rows store JSON as text and booleans as integers. The service layer
// hydrates these into the domain shapes; repositories deal only in raw rows.
export type RawSession = Omit<ResumeSession, 'analysis'> & { analysis: string | null };
export type RawVersion = Omit<ResumeVersion, 'content' | 'strategy' | 'is_final'> & {
  content: string;
  strategy: string;
  is_final: number;
};

export type SessionInsert = Omit<ResumeSession, 'analysis'>;
export type VersionInsert = Omit<ResumeVersion, 'content' | 'strategy' | 'is_final'> & {
  content: string;
  strategy: string;
};

// Data access for resume sessions, their chat messages, and resume versions.
class ResumeRepository {
  private readonly insertSessionStmt: Statement;
  private readonly listSessionsStmt: Statement;
  private readonly getSessionStmt: Statement;
  private readonly updateSessionStmt: Statement;
  private readonly deleteSessionStmt: Statement;
  private readonly setAnalysisStmt: Statement;
  private readonly insertMessageStmt: Statement;
  private readonly listMessagesStmt: Statement;
  private readonly insertVersionStmt: Statement;
  private readonly listVersionsStmt: Statement;
  private readonly getVersionStmt: Statement;
  private readonly latestVersionStmt: Statement;
  private readonly setTemplateStmt: Statement;
  private readonly clearFinalStmt: Statement;
  private readonly setFinalStmt: Statement;

  constructor() {
    this.insertSessionStmt = db.prepare(
      `INSERT INTO resume_sessions (id, title, personality_id, company_name, job_title,
        job_description, location, company_notes, created_at)
       VALUES (@id, @title, @personality_id, @company_name, @job_title,
        @job_description, @location, @company_notes, @created_at)`
    );
    this.listSessionsStmt = db.prepare('SELECT * FROM resume_sessions ORDER BY created_at DESC');
    this.getSessionStmt = db.prepare('SELECT * FROM resume_sessions WHERE id = ?');
    this.updateSessionStmt = db.prepare(
      `UPDATE resume_sessions SET title = @title, personality_id = @personality_id,
        company_name = @company_name, job_title = @job_title, job_description = @job_description,
        location = @location, company_notes = @company_notes WHERE id = @id`
    );
    this.deleteSessionStmt = db.prepare('DELETE FROM resume_sessions WHERE id = ?');
    this.setAnalysisStmt = db.prepare('UPDATE resume_sessions SET analysis = ? WHERE id = ?');

    this.insertMessageStmt = db.prepare(
      `INSERT INTO resume_messages (id, session_id, role, content, created_at)
       VALUES (@id, @session_id, @role, @content, @created_at)`
    );
    this.listMessagesStmt = db.prepare(
      'SELECT * FROM resume_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200'
    );

    this.insertVersionStmt = db.prepare(
      `INSERT INTO resume_versions (id, session_id, version_number, template_id, content, strategy, created_at)
       VALUES (@id, @session_id, @version_number, @template_id, @content, @strategy, @created_at)`
    );
    this.listVersionsStmt = db.prepare(
      'SELECT * FROM resume_versions WHERE session_id = ? ORDER BY version_number ASC'
    );
    this.getVersionStmt = db.prepare('SELECT * FROM resume_versions WHERE id = ?');
    this.latestVersionStmt = db.prepare(
      'SELECT * FROM resume_versions WHERE session_id = ? ORDER BY version_number DESC LIMIT 1'
    );
    this.setTemplateStmt = db.prepare('UPDATE resume_versions SET template_id = ? WHERE id = ?');
    this.clearFinalStmt = db.prepare('UPDATE resume_versions SET is_final = 0 WHERE session_id = ?');
    this.setFinalStmt = db.prepare('UPDATE resume_versions SET is_final = 1 WHERE id = ?');
  }

  // ---- Sessions ----

  insertSession(row: SessionInsert): void {
    this.insertSessionStmt.run(row);
  }

  listSessions(): RawSession[] {
    return this.listSessionsStmt.all() as RawSession[];
  }

  getSession(id: string): RawSession | undefined {
    return this.getSessionStmt.get(id) as RawSession | undefined;
  }

  updateSession(row: SessionInsert): void {
    this.updateSessionStmt.run(row);
  }

  deleteSession(id: string): void {
    this.deleteSessionStmt.run(id);
  }

  setAnalysis(id: string, analysisJson: string): void {
    this.setAnalysisStmt.run(analysisJson, id);
  }

  // ---- Messages ----

  appendMessage(message: ResumeMessage): void {
    this.insertMessageStmt.run(message);
  }

  listMessages(sessionId: string): ResumeMessage[] {
    return this.listMessagesStmt.all(sessionId) as ResumeMessage[];
  }

  // ---- Versions ----

  insertVersion(row: VersionInsert): void {
    this.insertVersionStmt.run(row);
  }

  listVersions(sessionId: string): RawVersion[] {
    return this.listVersionsStmt.all(sessionId) as RawVersion[];
  }

  getVersion(id: string): RawVersion | undefined {
    return this.getVersionStmt.get(id) as RawVersion | undefined;
  }

  getLatestVersion(sessionId: string): RawVersion | undefined {
    return this.latestVersionStmt.get(sessionId) as RawVersion | undefined;
  }

  setTemplate(id: string, templateId: string): void {
    this.setTemplateStmt.run(templateId, id);
  }

  markFinal(sessionId: string, versionId: string): void {
    const apply = db.transaction(() => {
      this.clearFinalStmt.run(sessionId);
      this.setFinalStmt.run(versionId);
    });
    apply();
  }
}

export const resumeRepository = new ResumeRepository();
