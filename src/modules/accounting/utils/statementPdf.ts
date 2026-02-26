/**
 * Customer Statement PDF Generator
 * Produces a portrait A4 PDF statement for a single customer
 * using jsPDF + jspdf-autotable (same pattern as reconReportPdf.ts)
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface StatementTransaction {
  date: string;
  type: 'invoice' | 'payment' | 'credit_note';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementData {
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  asAtDate: string;
  totalInvoiced: number;
  totalPaid: number;
  totalCredits: number;
  balanceOutstanding: number;
  transactions: StatementTransaction[];
}

const fmtZAR = (amount: number): string =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const fmtDate = (d: string): string => {
  if (!d) return '—';
  const parts = d.split('T')[0]?.split('-') ?? [];
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
};

function paintHeader(doc: jsPDF, data: StatementData): void {
  const PAGE_W = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('STATEMENT', 14, 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Velocity Fibre (Pty) Ltd', 14, 26);
  doc.text('VAT No: 4070313040', 14, 31);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(data.clientName, PAGE_W - 14, 18, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  if (data.clientEmail) doc.text(data.clientEmail, PAGE_W - 14, 24, { align: 'right' });
  if (data.clientPhone) doc.text(data.clientPhone, PAGE_W - 14, 29, { align: 'right' });

  doc.text(`Statement Date: ${fmtDate(data.asAtDate)}`, PAGE_W - 14, 35, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleString('en-ZA')}`, PAGE_W - 14, 40, { align: 'right' });

  doc.setDrawColor(200, 200, 200);
  doc.line(14, 44, PAGE_W - 14, 44);
}

function paintSummary(doc: jsPDF, data: StatementData, startY: number): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const BOX_H = 28;
  const COL = (PAGE_W - 28) / 4;

  doc.setFillColor(245, 247, 250);
  doc.setDrawColor(210, 215, 225);
  doc.roundedRect(14, startY, PAGE_W - 28, BOX_H, 2, 2, 'FD');

  const labelY = startY + 9;
  const valueY = startY + 20;

  const cols = [
    { label: 'Total Invoiced', value: data.totalInvoiced },
    { label: 'Total Paid', value: data.totalPaid },
    { label: 'Credits Applied', value: data.totalCredits },
    { label: 'Balance Due', value: data.balanceOutstanding },
  ];

  cols.forEach((col, i) => {
    const x = 14 + COL * i + COL / 2;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(col.label, x, labelY, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const isBalance = i === 3;
    if (isBalance && col.value > 0) {
      doc.setTextColor(180, 50, 50);
    } else if (isBalance) {
      doc.setTextColor(22, 163, 74);
    } else {
      doc.setTextColor(30, 30, 30);
    }
    doc.text(fmtZAR(col.value), x, valueY, { align: 'center' });
  });

  return startY + BOX_H + 6;
}

function paintTransactions(doc: jsPDF, txns: StatementTransaction[], startY: number): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const typeLabels: Record<string, string> = {
    invoice: 'Invoice',
    payment: 'Payment',
    credit_note: 'Credit Note',
  };

  const rows = txns.map(t => [
    fmtDate(t.date),
    typeLabels[t.type] || t.type,
    t.reference,
    t.description?.substring(0, 40) || '—',
    t.debit > 0 ? fmtZAR(t.debit) : '',
    t.credit > 0 ? fmtZAR(t.credit) : '',
    fmtZAR(t.balance),
  ]);

  autoTable(doc, {
    startY,
    head: [['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance']],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [41, 82, 140], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right', font: 'courier' },
      5: { halign: 'right', font: 'courier' },
      6: { halign: 'right', font: 'courier', fontStyle: 'bold' },
    },
    tableWidth: PAGE_W - 28,
    margin: { left: 14, right: 14 },
  });

  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

function paintFooters(doc: jsPDF): void {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const totalPages = (doc as jsPDF & { internal: { getNumberOfPages: () => number } })
    .internal.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.line(14, PAGE_H - 10, PAGE_W - 14, PAGE_H - 10);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W - 14, PAGE_H - 5, { align: 'right' });
    doc.text('FibreFlow Customer Statement — Confidential', 14, PAGE_H - 5);
  }
}

export function generateStatementPdf(data: StatementData): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  paintHeader(doc, data);
  let cursor = paintSummary(doc, data, 48);
  paintTransactions(doc, data.transactions, cursor);
  paintFooters(doc);

  return doc.output('blob');
}
