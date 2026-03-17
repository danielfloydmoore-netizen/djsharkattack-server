const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const FIRMA_KEY = 'firma_7568f96c93fb42f1811abc08153302456388faa366a5f44d';
const MONDAY_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYzNDI5OTgzNSwiYWFpIjoxMSwidWlkIjoyOTM2NzEyNiwiaWFkIjoiMjAyNi0wMy0xN1QxNzowOTo1Ny45NjRaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTE3Mjk2MzMsInJnbiI6InVzZTEifQ.oPYF0k3V2mlZ8MC7iVt2bh2kLkus8cFmfUSh33UnNvw';

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'DJ Shark Attack server is running!' });
});

// Send contract via Firma
app.post('/send-contract', async (req, res) => {
  try {
    const { clientName, pocName, pocEmail, contractText, emailMessage } = req.body;

    // Hardcoded workspace ID
    const workspaceId = '4f61bc62-4ee8-43bc-9e34-d6e438a9800a';

    // Step 2 — create signing request with PDF
    const base64Doc = Buffer.from(contractText).toString('base64');
    const createRes = await fetch('https://api.firma.dev/functions/v1/signing-request-api/signing-requests', {
      method: 'POST',
      headers: { 'Authorization': FIRMA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DJ Shark Attack Contract - ' + clientName,
        workspace_id: workspaceId,
        document_base64: base64Doc,
        document_filename: 'DJ_Shark_Attack_Contract.txt',
        recipients: [{
          id: 'temp_1',
          name: pocName || clientName,
          email: pocEmail,
          role: 'signer'
        }],
        settings: {
          send_signing_email: true,
          email_message: emailMessage
        }
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) return res.status(400).json({ error: 'Firma create error', detail: createData });

    // Step 3 — send it
    const sendRes = await fetch('https://api.firma.dev/functions/v1/signing-request-api/signing-requests/' + createData.id + '/send', {
      method: 'POST',
      headers: { 'Authorization': FIRMA_KEY, 'Content-Type': 'application/json' }
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) return res.status(400).json({ error: 'Firma send error', detail: sendData });

    res.json({ success: true, id: createData.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Log to Monday
app.post('/log-monday', async (req, res) => {
  try {
    const { boardId, itemName, eventDate, services, venue, contactInfo, phone, fee, deposit } = req.body;

    const colVals = JSON.stringify({
      'event_date__1': { date: eventDate || '' },
      'services__1': services || '',
      'event_location__1': venue || '',
      'contact_info__1': contactInfo || '',
      'bride_groom_cell___1': phone || '',
      'amount_due__1': fee || '',
      'deposit__1': deposit || '',
      'contract__1': { label: 'Contract Sent' }
    });

    const mutation = `mutation {
      create_item(
        board_id: ${boardId},
        item_name: "${itemName.replace(/"/g, '')}",
        column_values: ${JSON.stringify(colVals)}
      ) { id }
    }`;

    const monRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query: mutation })
    });

    const monData = await monRes.json();
    if (monData.data && monData.data.create_item) {
      res.json({ success: true, id: monData.data.create_item.id });
    } else {
      res.status(400).json({ error: 'Monday error', detail: monData });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DJ Shark Attack server running on port ' + PORT));
