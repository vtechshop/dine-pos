import nodemailer from 'nodemailer';
import { ILead } from '../models/Lead';

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendLeadAlertToAdmin(lead: ILead): Promise<void> {
  const to = process.env.LEAD_ALERT_EMAIL;
  if (!to) return;
  const transport = createTransport();
  if (!transport) return;

  await transport.sendMail({
    from: `"DinePOS Leads" <${process.env.SMTP_USER}>`,
    to,
    subject: `New Lead: ${lead.companyName} — ${lead.source === 'website_demo' ? 'Demo Request' : 'Contact Form'}`,
    html: `
      <h2 style="color:#1a1a2e">New Lead — DinePOS</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Company</td><td><strong>${lead.companyName}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Owner</td><td>${lead.ownerName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${lead.phone}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${lead.email}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Restaurant Type</td><td>${lead.restaurantType || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">City</td><td>${lead.city || '—'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Source</td><td>${lead.source}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Priority</td><td>${lead.priority}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:12px;color:#999">Lead ID: ${lead._id}</p>
    `,
  });
}

export async function sendDemoConfirmationToCustomer(lead: ILead): Promise<void> {
  if (!lead.email) return;
  const transport = createTransport();
  if (!transport) return;

  await transport.sendMail({
    from: `"DinePOS" <${process.env.SMTP_USER}>`,
    to: lead.email,
    subject: 'Thank you for booking DinePOS Demo',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1a1a2e">Thank You, ${lead.ownerName}!</h2>
        <p>We have received your demo request for <strong>${lead.companyName}</strong>.</p>
        <p>Our team will contact you shortly on <strong>${lead.phone}</strong> or via email to confirm your slot.</p>
        <br/>
        <p style="color:#666;font-size:13px">We will contact you shortly.</p>
        <p style="color:#666;font-size:13px">— Team DinePOS</p>
      </div>
    `,
  });
}
