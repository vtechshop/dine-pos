// Pure-function TallyPrime XML voucher builder.
// TallyPrime local HTTP interface: POST http://localhost:9000 with XML body.
// No I/O — only data in, XML string out.

export interface TallyLedgerEntry {
  ledgerName: string;
  amount: number;    // positive = Dr (debit side), negative = Cr (credit side)
}

export interface TallyVoucherParams {
  guid:          string;       // globally unique — used as REMOTEID for idempotency
  companyName:   string;
  voucherType:   'Sales' | 'Purchase' | 'Journal' | 'Payment' | 'Receipt';
  voucherDate:   Date;
  voucherNumber: string;
  narration:     string;
  ledgerEntries: TallyLedgerEntry[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// TallyPrime date format: YYYYMMDD
function tallyDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// TallyPrime sign convention: ISDEEMEDPOSITIVE="Yes" = Dr (increases balance).
// Amount field is always the absolute value; direction set by ISDEEMEDPOSITIVE.
function buildEntry(e: TallyLedgerEntry): string {
  const isDebit = e.amount >= 0;
  return `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
      <AMOUNT>${Math.abs(e.amount).toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`;
}

export function buildTallyVoucherXml(params: TallyVoucherParams): string {
  const entries = params.ledgerEntries.map(buildEntry).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(params.companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${esc(params.guid)}" VCHTYPE="${esc(params.voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <GUID>${esc(params.guid)}</GUID>
            <VOUCHERTYPENAME>${esc(params.voucherType)}</VOUCHERTYPENAME>
            <DATE>${tallyDate(params.voucherDate)}</DATE>
            <VOUCHERNUMBER>${esc(params.voucherNumber)}</VOUCHERNUMBER>
            <NARRATION>${esc(params.narration)}</NARRATION>
            <ISINVOICE>Yes</ISINVOICE>${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export function buildTallyCancellationXml(params: Omit<TallyVoucherParams, 'voucherType'>): string {
  return buildTallyVoucherXml({ ...params, voucherType: 'Journal' });
}

// Determines which payment ledger to use based on order paymentMethod
export function resolvePaymentLedger(
  paymentMethod: string,
  cashLedger: string,
  bankLedger: string,
): string {
  const bankModes = new Set(['upi', 'upi_intent', 'upi_qr', 'upi_collect', 'razorpay', 'card']);
  return bankModes.has(paymentMethod) ? bankLedger : cashLedger;
}

// Validates double-entry balance (sum of all entry amounts must be 0)
export function validateBalance(entries: TallyLedgerEntry[]): boolean {
  const sum = entries.reduce((acc, e) => acc + e.amount, 0);
  return Math.abs(sum) < 0.01;
}
