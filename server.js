const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const FIRMA_KEY = 'firma_7568f96c93fb42f1811abc08153302456388faa366a5f44d';
const MONDAY_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYzNDI5OTgzNSwiYWFpIjoxMSwidWlkIjoyOTM2NzEyNiwiaWFkIjoiMjAyNi0wMy0xN1QxNzowOTo1Ny45NjRaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTE3Mjk2MzMsInJnbiI6InVzZTEifQ.oPYF0k3V2mlZ8MC7iVt2bh2kLkus8cFmfUSh33UnNvw';

app.get('/', (req, res) => {
  res.json({ status: 'DJ Shark Attack server is running!' });
});

function textToPdfBase64(text) {
  const lines = text.split('\n');
  const pageHeight = 792;
  const pageWidth = 612;
  const margin = 50;
  const lineHeight = 13;
  const fontSize = 9;
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  const pdfLines = [];
  for (const line of lines) {
    if (line.length === 0) { pdfLines.push(''); continue; }
    for (let i = 0; i < line.length; i += 95) pdfLines.push(line.slice(i, i + 95));
  }
  const pages = [];
  for (let i = 0; i < pdfLines.length; i += linesPerPage) pages.push(pdfLines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push(['']);

  let objId = 1;
  const objs = {};
  const addObj = (content) => { objs[objId] = content; return objId++; };

  const catalogId = objId++;
  const pagesId = objId++;
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds = [];
  for (const pageLines of pages) {
    const esc = pageLines.map(l => l.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/\r/g,''));
    let s = `BT\n/F1 ${fontSize} Tf\n${margin} ${pageHeight - margin} Td\n${lineHeight} TL\n`;
    for (const l of esc) s += `(${l}) Tj T*\n`;
    s += 'ET';
    const cid = addObj(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    const pid = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    pageIds.push(pid);
  }
  objs[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId] = `<< /Type /Pages /Kids [${pageIds.map(i=>`${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  const maxId = objId - 1;
  for (let i = 1; i <= maxId; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) pdf += offsets[i].toString().padStart(10,'0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
}

app.post('/send-contract', async (req, res) => {
  try {
    const { clientName, pocName, pocEmail, contractText, emailMessage } = req.body;
    if (!pocEmail) return res.status(400).json({ error: 'Missing pocEmail' });
    if (!contractText) return res.status(400).json({ error: 'Missing contractText' });

    const pdfBase64 = textToPdfBase64(contractText);

    const createBody = {
      name: 'DJ Shark Attack Contract - ' + clientName,
      document: pdfBase64,
      recipients: [{ id: 'temp_1', name: pocName || clientName, email: pocEmail, role: 'signer' }],
      fields: [{ recipient_id: 'temp_1', type: 'signature', page: 1, x: 100, y: 650, width: 200, height: 50 }],
      settings: { send_signing_email: true, send_finish_email: true }
    };
    if (emailMessage) createBody.description = emailMessage;

    const createRes = await fetch('https://api.firma.dev/functions/v1/signing-request-api/signing-requests', {
      method: 'POST',
      headers: { 'Authorization': FIRMA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody)
    });
    const createData = await createRes.json();
    console.log('Firma create:', JSON.stringify(createData));
    if (!createRes.ok) return res.status(400).json({ error: 'Firma create error', detail: createData });

    const sendRes = await fetch(`https://api.firma.dev/functions/v1/signing-request-api/signing-requests/${createData.id}/send`, {
      method: 'POST',
      headers: { 'Authorization': FIRMA_KEY, 'Content-Type': 'application/json' }
    });
    const sendData = await sendRes.json();
    console.log('Firma send:', JSON.stringify(sendData));
    if (!sendRes.ok) return res.status(400).json({ error: 'Firma send error', detail: sendData });

    res.json({ success: true, id: createData.id });
  } catch (e) {
    console.error('send-contract error:', e);
    res.status(500).json({ error: e.message });
  }
});

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
    const mutation = `mutation { create_item(board_id: ${boardId}, item_name: "${itemName.replace(/"/g,'')}", column_values: ${JSON.stringify(colVals)}) { id } }`;
    const monRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query: mutation })
    });
    const monData = await monRes.json();
    if (monData.data && monData.data.create_item) res.json({ success: true, id: monData.data.create_item.id });
    else res.status(400).json({ error: 'Monday error', detail: monData });
  } catch (e) {
    console.error('log-monday error:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DJ Shark Attack server running on port ' + PORT));
