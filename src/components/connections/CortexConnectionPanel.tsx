import { ConnectorSetupCard } from './ConnectorSetupCard';

const CORTEX_MCP_ENDPOINT =
  'https://app.fibreflow.app/api/cortex-remote-mcp/mcp';

export function CortexConnectionPanel() {
  return (
    <ConnectorSetupCard
      heading="Cortex Knowledge"
      description="Search meetings, email, WhatsApp, SharePoint, timelines and cited evidence allowed by your Cortex access. The connector is read-only and cannot add, change, approve or delete anything."
      endpoint={CORTEX_MCP_ENDPOINT}
      consentDescription="The browser window verifies your FibreFlow identity and applies your approved Cortex scope without asking you to handle credentials."
    />
  );
}
