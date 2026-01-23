#!/usr/bin/env python3
"""
Harness Trigger Service - 2-Stage Pipeline

FastAPI service that implements a 2-stage development pipeline:
- Stage 1: POC Loop (quick validation, 1-5 hours)
- Stage 2: Full Harness (production-ready, 4-24 hours)

Port: 8096
"""

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from enum import Enum
import httpx
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel

from spec_generator import generate_spec_file, WorkType

app = FastAPI(
    title="Harness Trigger Service",
    description="2-Stage Pipeline: POC Loop → Full Harness",
    version="2.0.0",
)

# Configuration
HARNESS_PATH = os.getenv("HARNESS_PATH", "/home/louisdup/Agents/claude/VF/harness")
FIBREFLOW_WEBHOOK_URL = os.getenv("FIBREFLOW_WEBHOOK_URL", "https://vf.fibreflow.app/api/wishlist")
WEBHOOK_SECRET = os.getenv("HARNESS_TRIGGER_SECRET", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Email notification config (Resend)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
NOTIFY_EMAIL = os.getenv("NOTIFY_EMAIL", "ai@velocityfibre.co.za")

# Track builds
poc_builds: dict[str, dict] = {}
harness_builds: dict[str, dict] = {}


class PipelineStage(str, Enum):
    POC = "poc"
    HARNESS = "harness"


class BuildSpec(BaseModel):
    title: str
    description: Optional[str] = None
    problem_statement: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    target_module: Optional[str] = None
    test_scenarios: Optional[str] = None
    effort_estimate: Optional[str] = None
    priority: Optional[str] = None


class TriggerRequest(BaseModel):
    item_id: str
    work_type: WorkType = WorkType.FEATURE
    stage: PipelineStage = PipelineStage.POC
    github_issue_number: int
    github_issue_url: str
    spec: BuildSpec


class TriggerResponse(BaseModel):
    success: bool
    run_id: Optional[str] = None
    stage: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


class BuildStatus(BaseModel):
    item_id: str
    run_id: str
    stage: str
    status: str
    progress: int
    features_total: int
    features_completed: int
    error: Optional[str] = None
    started_at: Optional[str] = None


async def send_email_notification(subject: str, html_body: str):
    """Send email notification via Resend"""
    if not RESEND_API_KEY or not NOTIFY_EMAIL:
        print("Email not configured, skipping notification")
        return

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": "FibreFlow Pipeline <onboarding@resend.dev>",
                    "to": [NOTIFY_EMAIL],
                    "subject": subject,
                    "html": html_body,
                },
                timeout=10,
            )
            if response.status_code == 200:
                print(f"Email notification sent to {NOTIFY_EMAIL}")
            else:
                print(f"Email notification failed: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Failed to send email notification: {e}")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "2-stage-pipeline",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "harness_path": HARNESS_PATH,
        "poc_builds": len(poc_builds),
        "harness_builds": len(harness_builds),
        "email_configured": bool(RESEND_API_KEY and NOTIFY_EMAIL),
    }


@app.post("/trigger", response_model=TriggerResponse)
async def trigger_build(
    request: TriggerRequest,
    background_tasks: BackgroundTasks,
    x_webhook_secret: str = Header(None),
):
    """Trigger a build for a wishlist item (POC or Full Harness)"""

    # Verify secret
    if x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    # Check stage and existing builds
    builds_dict = poc_builds if request.stage == PipelineStage.POC else harness_builds
    stage_name = "POC" if request.stage == PipelineStage.POC else "Harness"

    if request.item_id in builds_dict:
        existing = builds_dict[request.item_id]
        if existing.get("status") in ["queued", "running"]:
            return TriggerResponse(
                success=False,
                error=f"{stage_name} build already in progress for this item",
            )

    # Generate run ID
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    run_id = f"{request.stage.value}_{request.work_type.value}_{request.item_id[:8]}_{timestamp}"

    # Generate spec file
    spec_path = Path(HARNESS_PATH) / "specs" / f"{run_id}.md"
    try:
        generate_spec_file(
            spec_path=spec_path,
            work_type=request.work_type,
            title=request.spec.title,
            description=request.spec.description,
            problem_statement=request.spec.problem_statement,
            acceptance_criteria=request.spec.acceptance_criteria,
            target_module=request.spec.target_module,
            test_scenarios=request.spec.test_scenarios,
            github_issue_url=request.github_issue_url,
        )
    except Exception as e:
        return TriggerResponse(success=False, error=f"Failed to generate spec: {e}")

    # Build info
    build_info = {
        "item_id": request.item_id,
        "run_id": run_id,
        "stage": request.stage.value,
        "work_type": request.work_type.value,
        "spec_path": str(spec_path),
        "github_issue_url": request.github_issue_url,
        "github_issue_number": request.github_issue_number,
        "title": request.spec.title,
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "status": "queued",
        "progress": 0,
    }

    builds_dict[request.item_id] = build_info

    # Prepare email notification
    work_type_emoji = {
        "feature": "✨",
        "fix": "🐛",
        "amendment": "📝",
        "refactor": "🔧",
    }.get(request.work_type.value, "📦")

    stage_emoji = "🧪" if request.stage == PipelineStage.POC else "🏗️"
    stage_label = "POC Validation" if request.stage == PipelineStage.POC else "Full Harness Build"

    subject = f"{stage_emoji} {stage_label}: {request.spec.title[:50]}"

    # Different commands based on stage
    if request.stage == PipelineStage.POC:
        build_command = f"/poc {run_id.replace('poc_', '')} 30"
        build_command_alt = f"./harness/poc_loop.sh {run_id.replace('poc_', '')} 30"
        estimated_time = "1-5 hours"
        next_step = "If POC passes, item will move to 'Building' for full harness."
    else:
        build_command = f"/agents/build {run_id.replace('harness_', '')}"
        build_command_alt = f"./harness/runner.py --agent {run_id.replace('harness_', '')}"
        estimated_time = "4-24 hours"
        next_step = "When complete, a PR will be created and item moves to 'Done'."

    html_body = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">{stage_emoji} {stage_label} Queued</h2>

        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Type:</strong> {work_type_emoji} {request.work_type.value.upper()}</p>
            <p style="margin: 8px 0 0;"><strong>Title:</strong> {request.spec.title}</p>
            <p style="margin: 8px 0 0;"><strong>Estimated Time:</strong> {estimated_time}</p>
        </div>

        <p><strong>GitHub Issue:</strong> <a href="{request.github_issue_url}">#{request.github_issue_number}</a></p>
        <p><strong>Spec File:</strong> <code>{run_id}.md</code></p>

        <div style="background: #dbeafe; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>📋 Next Step:</strong></p>
            <p style="margin: 8px 0 0;">{next_step}</p>
        </div>

        <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>To build manually:</strong></p>
            <pre style="background: #1f2937; color: #f9fafb; padding: 12px; border-radius: 4px; overflow-x: auto;">{build_command}</pre>
            <p style="margin: 8px 0 0; font-size: 14px;">Or: <code>{build_command_alt}</code></p>
        </div>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #6b7280; font-size: 12px;">
            FibreFlow 2-Stage Pipeline Service<br>
            <a href="http://100.96.203.105:8096/queue">View Queue</a>
        </p>
    </div>
    """

    background_tasks.add_task(send_email_notification, subject, html_body)

    return TriggerResponse(
        success=True,
        run_id=run_id,
        stage=request.stage.value,
        message=f"{stage_label} queued: {run_id}. Email notification sent.",
    )


@app.get("/queue")
async def get_queue():
    """Get all queued builds"""
    poc_queued = [b for b in poc_builds.values() if b["status"] == "queued"]
    harness_queued = [b for b in harness_builds.values() if b["status"] == "queued"]

    return {
        "poc": poc_queued,
        "harness": harness_queued,
        "total_poc": len(poc_builds),
        "total_harness": len(harness_builds),
    }


@app.get("/status/{item_id}")
async def get_build_status(item_id: str, stage: PipelineStage = PipelineStage.POC):
    """Get status of a build"""

    builds_dict = poc_builds if stage == PipelineStage.POC else harness_builds

    if item_id not in builds_dict:
        raise HTTPException(status_code=404, detail=f"No {stage.value} build found for this item")

    build = builds_dict[item_id]
    return BuildStatus(
        item_id=item_id,
        run_id=build["run_id"],
        stage=build["stage"],
        status=build["status"],
        progress=build["progress"],
        features_total=build.get("features_total", 0),
        features_completed=build.get("features_completed", 0),
        error=build.get("error"),
        started_at=build.get("queued_at"),
    )


@app.post("/status/{item_id}/update")
async def update_build_status(
    item_id: str,
    status: str,
    progress: int = 0,
    stage: PipelineStage = PipelineStage.POC,
    features_total: int = 0,
    features_completed: int = 0,
    error: Optional[str] = None,
    pr_url: Optional[str] = None,
    x_webhook_secret: str = Header(None),
):
    """Update build status (called by POC loop or harness)"""

    if x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    builds_dict = poc_builds if stage == PipelineStage.POC else harness_builds

    if item_id not in builds_dict:
        raise HTTPException(status_code=404, detail="Build not found")

    build = builds_dict[item_id]
    build["status"] = status
    build["progress"] = progress
    build["features_total"] = features_total
    build["features_completed"] = features_completed

    if error:
        build["error"] = error
    if pr_url:
        build["pr_url"] = pr_url

    # Report to FibreFlow
    await report_progress(
        item_id=item_id,
        stage=stage.value,
        status=status,
        progress=progress,
        run_id=build["run_id"],
        features_total=features_total,
        features_completed=features_completed,
        error_message=error,
        pr_url=pr_url,
    )

    return {"success": True, "status": status}


@app.get("/builds")
async def list_builds():
    """List all builds"""
    return {
        "poc_builds": list(poc_builds.values()),
        "harness_builds": list(harness_builds.values()),
    }


async def report_progress(
    item_id: str,
    stage: str,
    status: str,
    progress: int,
    run_id: str,
    features_total: int = 0,
    features_completed: int = 0,
    error_message: Optional[str] = None,
    pr_url: Optional[str] = None,
):
    """Report progress back to FibreFlow"""

    if not FIBREFLOW_WEBHOOK_URL or not WEBHOOK_SECRET:
        return

    payload = {
        "stage": stage,
        "status": status,
        "progress": progress,
        "features_total": features_total,
        "features_completed": features_completed,
        "run_id": run_id,
    }

    if error_message:
        payload["error_message"] = error_message
    if pr_url:
        payload["pr_url"] = pr_url

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{FIBREFLOW_WEBHOOK_URL}/{item_id}/progress",
                json=payload,
                headers={"x-webhook-secret": WEBHOOK_SECRET},
                timeout=10,
            )
    except Exception as e:
        print(f"Failed to report progress: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8096)
