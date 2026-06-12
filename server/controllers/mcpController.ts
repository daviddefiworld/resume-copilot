import type { Request, Response } from 'express';
import { mcpService } from '../services/mcpService.ts';
import { param } from '../middleware/asyncHandler.ts';
import type { McpServerInput } from '../../shared/types.ts';

// HTTP layer for MCP server management. Parses requests and delegates to the
// service; connecting and tool calls happen elsewhere.
export const mcpController = {
  listServers(_req: Request, res: Response): void {
    res.json(mcpService.listView());
  },

  catalog(_req: Request, res: Response): void {
    res.json(mcpService.catalog());
  },

  async addServer(req: Request, res: Response): Promise<void> {
    res.status(201).json(await mcpService.add(req.body as McpServerInput));
  },

  async importServers(req: Request, res: Response): Promise<void> {
    res.status(201).json(await mcpService.importConfig((req.body as { config?: unknown }).config));
  },

  async updateServer(req: Request, res: Response): Promise<void> {
    res.json(await mcpService.update(param(req, 'id'), req.body as McpServerInput));
  },

  async deleteServer(req: Request, res: Response): Promise<void> {
    await mcpService.delete(param(req, 'id'));
    res.json({ ok: true });
  },

  async testServer(req: Request, res: Response): Promise<void> {
    res.json(await mcpService.test(param(req, 'id')));
  }
};
