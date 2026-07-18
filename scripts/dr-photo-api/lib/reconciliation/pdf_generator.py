"""
Reconciliation PDF Report Generator

Creates professional PDF reports with charts, metrics, and AI commentary
for daily reconciliation reports.
"""

import logging
import re
from datetime import date, datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from io import BytesIO

from lib.reconciliation.models import ReconciliationReport, ReconciliationSummary

logger = logging.getLogger(__name__)

# PDF generation
try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, Image, KeepTogether, PageBreak
    )
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
    from reportlab.pdfgen import canvas
    HAS_REPORTLAB = True
except ImportError:
    HAS_REPORTLAB = False
    logger.warning("reportlab not installed. PDF generation disabled.")

# Chart generation
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    logger.warning("matplotlib not installed. Chart generation disabled.")


class NumberedCanvas(canvas.Canvas):
    """Custom canvas class to add page numbers and header/footer."""

    def __init__(self, *args, report_title: str = "Reconciliation Report", **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []
        self._report_title = report_title

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        """Add the page number to each page."""
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_header_footer(self, page_count):
        """Draw header and footer on each page."""
        page_num = self._pageNumber
        width, height = A4

        # Footer
        self.setFont('Helvetica', 8)
        self.setFillColor(colors.HexColor('#7f8c8d'))

        # Page number (centered)
        self.drawCentredString(width / 2, 12 * mm, f"Page {page_num} of {page_count}")

        # Report branding (left)
        self.drawString(15 * mm, 12 * mm, f"BOSS {self._report_title}")

        # Date (right)
        self.drawRightString(width - 15 * mm, 12 * mm, f"{datetime.now().strftime('%Y-%m-%d')}")

        # Footer line
        self.setStrokeColor(colors.HexColor('#bdc3c7'))
        self.setLineWidth(0.5)
        self.line(15 * mm, 18 * mm, width - 15 * mm, 18 * mm)


class ReconciliationPDFGenerator:
    """
    Generates professional PDF reports from ReconciliationReport data.

    Features:
    - Executive summary with key metrics
    - Visual charts for trend analysis
    - Detailed gap analysis tables
    - AI-generated commentary and recommendations
    - Comparison with previous days
    """

    # Styling constants
    HEADER_FILL = colors.HexColor('#1F4E79')
    HEADER_TEXT = colors.white
    GOOD_COLOR = colors.HexColor('#27ae60')
    WARNING_COLOR = colors.HexColor('#f39c12')
    CRITICAL_COLOR = colors.HexColor('#e74c3c')
    NEUTRAL_COLOR = colors.HexColor('#34495e')

    def __init__(self, output_dir: str = "data/reconciliation"):
        """Initialize generator with output directory."""
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate(
        self,
        report: ReconciliationReport,
        historical_data: List[Dict[str, Any]] = None,
        ai_commentary: Dict[str, Any] = None,
        filename: Optional[str] = None
    ) -> Optional[Path]:
        """
        Generate PDF report from reconciliation data.

        Args:
            report: ReconciliationReport with current data
            historical_data: List of previous days' summaries for trend analysis
            ai_commentary: AI-generated analysis (from Claude Code CLI)
            filename: Optional custom filename

        Returns:
            Path to generated PDF file, or None if generation failed
        """
        if not HAS_REPORTLAB:
            logger.error("ReportLab not installed, cannot generate PDF")
            return None

        # Generate filename
        if not filename:
            filename = (
                f"{report.summary.project}_reconciliation_"
                f"{report.summary.report_date.strftime('%Y-%m-%d')}.pdf"
            )

        pdf_path = self.output_dir / filename
        logger.info(f"Generating PDF report: {pdf_path}")

        # Generate charts
        charts = {}
        if HAS_MATPLOTLIB and historical_data:
            charts = self._generate_charts(report, historical_data)

        # Create PDF
        doc = SimpleDocTemplate(
            str(pdf_path),
            pagesize=A4,
            rightMargin=15*mm,
            leftMargin=15*mm,
            topMargin=15*mm,
            bottomMargin=25*mm
        )

        styles = getSampleStyleSheet()
        story = self._build_story(report, historical_data, ai_commentary, charts, styles)

        # Build PDF with custom canvas for page numbers
        report_title = f"{report.summary.project_display_name} Reconciliation"

        def canvas_maker(filename, **kwargs):
            return NumberedCanvas(filename, report_title=report_title, **kwargs)

        doc.build(story, canvasmaker=canvas_maker)

        logger.info(f"PDF report saved: {pdf_path}")
        return pdf_path

    def _build_story(
        self,
        report: ReconciliationReport,
        historical_data: List[Dict[str, Any]],
        ai_commentary: Dict[str, Any],
        charts: Dict[str, BytesIO],
        styles
    ) -> list:
        """Build the PDF story (content)."""
        story = []
        summary = report.summary

        # Custom styles
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=22,
            spaceAfter=10,
            alignment=TA_CENTER,
            textColor=self.NEUTRAL_COLOR
        )

        heading_style = ParagraphStyle(
            'CustomHeading',
            parent=styles['Heading2'],
            fontSize=14,
            spaceBefore=14,
            spaceAfter=6,
            textColor=self.NEUTRAL_COLOR
        )

        subheading_style = ParagraphStyle(
            'CustomSubheading',
            parent=styles['Heading3'],
            fontSize=11,
            spaceBefore=10,
            spaceAfter=4,
            textColor=colors.HexColor('#7f8c8d')
        )

        body_style = ParagraphStyle(
            'CustomBody',
            parent=styles['Normal'],
            fontSize=9,
            spaceAfter=4
        )

        ai_style = ParagraphStyle(
            'AIStyle',
            parent=styles['Normal'],
            fontSize=9,
            spaceAfter=4,
            leftIndent=10,
            textColor=self.NEUTRAL_COLOR
        )

        # Title
        story.append(Paragraph(
            f"{summary.project_display_name.upper()} DAILY RECONCILIATION REPORT",
            title_style
        ))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            f"<b>Report Date:</b> {summary.report_date.strftime('%Y-%m-%d')} | "
            f"<b>Generated:</b> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            body_style
        ))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#bdc3c7')))
        story.append(Spacer(1, 10))

        # Executive Summary Section
        story.append(Paragraph("EXECUTIVE SUMMARY", heading_style))

        # Key Metrics Table
        match_rate_color = (
            self.GOOD_COLOR if summary.match_rate >= 90
            else self.WARNING_COLOR if summary.match_rate >= 70
            else self.CRITICAL_COLOR
        )

        metrics_data = [
            ['Metric', 'Value', 'Status'],
            ['WhatsApp Submissions', str(summary.wa_submission_count), 'QA Verified Drops'],
            ['OES Activations', str(summary.oes_activation_count), 'Nokia_Exp Records'],
            ['Matched Records', str(summary.matched_count), 'Both Sources'],
            ['WA Only (Not Activated)', str(summary.wa_only_count), 'Pending Action' if summary.wa_only_count > 0 else 'OK'],
            ['OES Only (No QA Photo)', str(summary.oes_only_count), 'Needs Review' if summary.oes_only_count > 0 else 'OK'],
            ['Match Rate', f'{summary.match_rate:.1f}%', 'Good' if summary.match_rate >= 90 else 'Needs Attention'],
        ]

        metrics_table = Table(metrics_data, colWidths=[100*mm, 40*mm, 40*mm])
        metrics_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), self.HEADER_FILL),
            ('TEXTCOLOR', (0, 0), (-1, 0), self.HEADER_TEXT),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#bdc3c7')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8f9fa')]),
        ]))

        story.append(metrics_table)
        story.append(Spacer(1, 15))

        # Trend Chart (if available)
        if 'trend_chart' in charts:
            story.append(Paragraph("TREND ANALYSIS", heading_style))
            story.append(Image(charts['trend_chart'], width=180*mm, height=60*mm))
            story.append(Spacer(1, 10))

        # Historical Comparison (if available)
        if historical_data and len(historical_data) > 1:
            story.append(Paragraph("HISTORICAL COMPARISON", heading_style))

            history_headers = ['Date', 'WA Subs', 'OES Act', 'Matched', 'Match Rate']
            history_data = [history_headers]

            for day in historical_data[-7:]:  # Last 7 days
                row = [
                    day.get('date', 'N/A'),
                    str(day.get('wa_submissions', 0)),
                    str(day.get('oes_activations', 0)),
                    str(day.get('matched', 0)),
                    f"{day.get('match_rate', 0):.1f}%"
                ]
                history_data.append(row)

            history_table = Table(history_data, colWidths=[40*mm, 30*mm, 30*mm, 30*mm, 30*mm])
            history_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), self.HEADER_FILL),
                ('TEXTCOLOR', (0, 0), (-1, 0), self.HEADER_TEXT),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#bdc3c7')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8f9fa')]),
            ]))

            story.append(history_table)
            story.append(Spacer(1, 15))

        # AI Commentary Section
        if ai_commentary and ai_commentary.get('full_commentary'):
            story.append(Paragraph("AI ANALYSIS & RECOMMENDATIONS", heading_style))
            story.append(Spacer(1, 5))

            # Parse and format the AI commentary
            commentary_text = ai_commentary.get('full_commentary', '')
            formatted_commentary = self._format_ai_commentary(commentary_text, ai_style, subheading_style)
            story.extend(formatted_commentary)

            # Source attribution
            story.append(Spacer(1, 5))
            source = ai_commentary.get('source', 'AI Analysis')
            story.append(Paragraph(
                f"<i>Analysis source: {source}</i>",
                ParagraphStyle('SourceStyle', parent=body_style, fontSize=8, textColor=colors.gray)
            ))
            story.append(Spacer(1, 10))

        # Gap Analysis Section
        if report.wa_only_records or report.oes_only_records:
            story.append(PageBreak())
            story.append(Paragraph("GAP ANALYSIS DETAILS", heading_style))

            # WA Only Gaps
            if report.wa_only_records:
                story.append(Paragraph("Drops Done - Not Yet Activated", subheading_style))
                story.append(Paragraph(
                    "These DR numbers have QA photo verification but no OES activation:",
                    body_style
                ))

                wa_gap_data = [['DR Number', 'Submission Date', 'Verification Steps', 'Contractor']]
                for rec in report.wa_only_records[:20]:  # Limit to 20
                    wa_gap_data.append([
                        rec.dr_number,
                        rec.submission_date.strftime('%Y-%m-%d') if rec.submission_date else 'N/A',
                        f"{rec.verification_steps}/12",
                        rec.contractor or 'N/A'
                    ])

                wa_table = Table(wa_gap_data, colWidths=[50*mm, 35*mm, 35*mm, 50*mm])
                wa_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f39c12')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 9),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                    ('FONTSIZE', (0, 1), (-1, -1), 8),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#bdc3c7')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#fef9e7'), colors.white]),
                ]))

                story.append(wa_table)

                if len(report.wa_only_records) > 20:
                    story.append(Paragraph(
                        f"<i>... and {len(report.wa_only_records) - 20} more records (see Excel for full list)</i>",
                        body_style
                    ))
                story.append(Spacer(1, 15))

            # OES Only Gaps
            if report.oes_only_records:
                story.append(Paragraph("Activated Without QA Photo Verification", subheading_style))
                story.append(Paragraph(
                    "These DR numbers are activated but have no WhatsApp Monitor submission:",
                    body_style
                ))

                oes_gap_data = [['DR Number', 'OLT', 'Activation Date', 'Status']]
                for rec in report.oes_only_records[:20]:  # Limit to 20
                    oes_gap_data.append([
                        rec.dr_number,
                        rec.olt,
                        rec.activation_date.strftime('%Y-%m-%d') if rec.activation_date else 'N/A',
                        rec.status
                    ])

                oes_table = Table(oes_gap_data, colWidths=[50*mm, 40*mm, 35*mm, 45*mm])
                oes_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e74c3c')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 9),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                    ('FONTSIZE', (0, 1), (-1, -1), 8),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#bdc3c7')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#fdedec'), colors.white]),
                ]))

                story.append(oes_table)

                if len(report.oes_only_records) > 20:
                    story.append(Paragraph(
                        f"<i>... and {len(report.oes_only_records) - 20} more records (see Excel for full list)</i>",
                        body_style
                    ))

        # Data Sources Footer
        story.append(Spacer(1, 20))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#bdc3c7')))
        story.append(Spacer(1, 5))
        story.append(Paragraph("DATA SOURCES", subheading_style))
        story.append(Paragraph(
            f"<b>WhatsApp Monitor:</b> {summary.wa_data_source}",
            body_style
        ))
        story.append(Paragraph(
            f"<b>OES Activations:</b> {summary.oes_data_source}",
            body_style
        ))
        story.append(Spacer(1, 10))
        story.append(Paragraph(
            "<i>Generated by BOSS VPS Daily Reconciliation Processor</i>",
            ParagraphStyle('FooterStyle', parent=body_style, fontSize=8, textColor=colors.gray)
        ))

        return story

    def _format_ai_commentary(self, commentary_text: str, body_style, heading_style) -> list:
        """Format AI commentary for PDF rendering."""
        elements = []

        # Split by markdown headers
        sections = re.split(r'\n(?=#+\s+)', commentary_text)

        for section in sections:
            if not section.strip():
                continue

            # Check for header
            header_match = re.match(r'^(#+)\s+(.+?)(?:\n|$)', section)
            if header_match:
                level = len(header_match.group(1))
                header_text = header_match.group(2).strip()
                content = section[header_match.end():]

                # Add heading
                if level <= 2:
                    elements.append(Paragraph(f"<b>{header_text}</b>", heading_style))
                else:
                    elements.append(Paragraph(f"<b>{header_text}</b>", body_style))

                # Process content
                if content.strip():
                    content = self._clean_markdown(content)
                    elements.append(Paragraph(content, body_style))
            else:
                # Plain text
                cleaned = self._clean_markdown(section)
                if cleaned.strip():
                    elements.append(Paragraph(cleaned, body_style))

            elements.append(Spacer(1, 5))

        return elements

    def _clean_markdown(self, text: str) -> str:
        """Clean markdown for PDF rendering."""
        # Convert bullet points
        text = re.sub(r'^[-*]\s+', '• ', text, flags=re.MULTILINE)
        # Convert bold
        text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
        # Convert italic
        text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
        # Remove extra whitespace
        text = re.sub(r'\n\s*\n', '\n', text)
        return text.strip()

    def _generate_charts(
        self,
        report: ReconciliationReport,
        historical_data: List[Dict[str, Any]]
    ) -> Dict[str, BytesIO]:
        """Generate trend charts from historical data."""
        charts = {}

        if not historical_data or len(historical_data) < 2:
            return charts

        try:
            plt.style.use('seaborn-v0_8-whitegrid')

            # Extract data for trend chart
            dates = [d.get('date', '') for d in historical_data]
            wa_subs = [d.get('wa_submissions', 0) for d in historical_data]
            oes_acts = [d.get('oes_activations', 0) for d in historical_data]
            match_rates = [d.get('match_rate', 0) for d in historical_data]

            # Create trend chart
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 3.5))

            # Chart 1: WA vs OES trend
            x = range(len(dates))
            ax1.plot(x, wa_subs, marker='o', label='WA Submissions', color='#3498db', linewidth=2)
            ax1.plot(x, oes_acts, marker='s', label='OES Activations', color='#2ecc71', linewidth=2)
            ax1.set_title('WA Submissions vs OES Activations', fontsize=10, fontweight='bold')
            ax1.set_ylabel('Count', fontsize=9)
            ax1.legend(fontsize=8)
            ax1.set_xticks(x)
            ax1.set_xticklabels([d[-5:] if len(d) > 5 else d for d in dates], rotation=45, fontsize=7)

            # Chart 2: Match Rate trend
            ax2.fill_between(x, match_rates, alpha=0.3, color='#9b59b6')
            ax2.plot(x, match_rates, marker='o', color='#9b59b6', linewidth=2)
            ax2.axhline(y=90, color='#27ae60', linestyle='--', alpha=0.7, label='Target (90%)')
            ax2.set_title('Match Rate Trend', fontsize=10, fontweight='bold')
            ax2.set_ylabel('Match Rate (%)', fontsize=9)
            ax2.set_ylim(0, 105)
            ax2.legend(fontsize=8)
            ax2.set_xticks(x)
            ax2.set_xticklabels([d[-5:] if len(d) > 5 else d for d in dates], rotation=45, fontsize=7)

            plt.tight_layout()

            trend_chart = BytesIO()
            plt.savefig(trend_chart, format='png', dpi=150, bbox_inches='tight')
            trend_chart.seek(0)
            charts['trend_chart'] = trend_chart
            plt.close()

            logger.info("Generated trend chart")

        except Exception as e:
            logger.error(f"Chart generation failed: {e}")
            import traceback
            traceback.print_exc()

        return charts


def generate_reconciliation_pdf(
    report: ReconciliationReport,
    historical_data: List[Dict[str, Any]] = None,
    ai_commentary: Dict[str, Any] = None,
    output_dir: str = "data/reconciliation",
    filename: Optional[str] = None
) -> Optional[Path]:
    """
    Convenience function to generate PDF report.

    Args:
        report: ReconciliationReport data
        historical_data: Previous days' summaries for trend analysis
        ai_commentary: AI-generated analysis
        output_dir: Output directory path
        filename: Optional custom filename

    Returns:
        Path to generated PDF file, or None if generation failed
    """
    generator = ReconciliationPDFGenerator(output_dir)
    return generator.generate(report, historical_data, ai_commentary, filename)
