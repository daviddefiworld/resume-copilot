import type { McpCatalogEntry } from '../../shared/types.ts';

// A small curated catalog of popular MCP servers for one-click install. The
// stdio entries run through `npx`, so they need Node/npm on the machine's PATH
// (true in dev and for any packaged install where Node is present). Anything not
// listed here can still be added with the manual form. `requires` fields are
// values the user must provide before the server works (an API key, a folder).
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, search, and write files within folders you allow. Great for working with local resumes and documents.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    requires: [
      { key: 'root', label: 'Allowed folder', placeholder: 'C:\\Users\\you\\Documents', target: 'arg' }
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
  },
  {
    id: 'memory',
    name: 'Knowledge Graph Memory',
    description: 'A persistent knowledge graph the agent can store and recall facts in across the conversation.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Gives the agent a structured scratchpad to break hard problems into ordered, revisable steps.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking'
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search via the Brave Search API. Requires a free Brave Search API key.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requires: [
      { key: 'BRAVE_API_KEY', label: 'Brave API key', placeholder: 'BSA…', target: 'env' }
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Browse repos, read files, search code, and manage issues/PRs. Requires a GitHub personal access token.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requires: [
      { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub token', placeholder: 'ghp_…', target: 'env' }
    ],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
  },
  {
    id: 'everything',
    name: 'Everything (demo)',
    description: 'The reference MCP server exercising every protocol feature — handy for testing your setup.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything'
  }
];
