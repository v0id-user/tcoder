#!/usr/bin/env python3
"""
TCoder Client Flow Script - Production

Production workflow:
1. Request presigned upload URL
2. Upload video file to R2
3. Wait for R2 webhook to automatically trigger processing
4. Poll for job completion

Usage:
    python client_flow_prod.py video.mp4 --domain api.example.com
    python client_flow_prod.py video.mp4 --domain api.example.com --preset web-optimized
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class TcoderClient:
    """Client for TCoder transcoding API - uses only standard library"""

    def __init__(self, base_url: str) -> None:
        self.base_url: str = base_url.rstrip("/")
        # Ensure HTTPS for production
        if not self.base_url.startswith(("http://", "https://")):
            self.base_url = f"https://{self.base_url}"
        self.api_base: str = f"{self.base_url}/api"

    def _request(
        self,
        method: str,
        url: str,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Make HTTP request and return JSON response"""
        req_headers: Dict[str, str] = {"Content-Type": "application/json"}
        if headers:
            req_headers.update(headers)

        req_data: Optional[bytes] = None
        if data:
            req_data = json.dumps(data).encode("utf-8")

        req = Request(url, data=req_data, headers=req_headers, method=method)
        try:
            with urlopen(req) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            raise Exception(f"HTTP {e.code}: {error_body}")
        except URLError as e:
            raise Exception(f"Network error: {e.reason}")

    def _put_file(self, url: str, file_path: Path, content_type: str) -> None:
        """Upload file using PUT request"""
        with open(file_path, "rb") as f:
            file_data = f.read()

        req = Request(url, data=file_data, method="PUT")
        req.add_header("Content-Type", content_type)
        try:
            with urlopen(req) as response:
                if response.status != 200:
                    raise Exception(f"Upload failed with status {response.status}")
        except HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            raise Exception(f"Upload failed: HTTP {e.code}: {error_body}")
        except URLError as e:
            raise Exception(f"Upload network error: {e.reason}")

    def request_upload_url(
        self,
        filename: str,
        content_type: str = "video/mp4",
        preset: str = "default",
        output_qualities: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Request a presigned upload URL"""
        url: str = f"{self.api_base}/upload"
        payload: Dict[str, Any] = {
            "filename": filename,
            "contentType": content_type,
            "preset": preset,
        }
        if output_qualities:
            payload["outputQualities"] = output_qualities

        print(f"Requesting upload URL for {filename}...")
        data: Dict[str, Any] = self._request("POST", url, payload)
        print(f"Upload URL received. Job ID: {data['jobId']}")
        return data

    def upload_file(self, upload_url: str, file_path: Path, content_type: str) -> None:
        """Upload file to presigned URL"""
        print(f"Uploading {file_path.name} to R2...")
        self._put_file(upload_url, file_path, content_type)
        print(f"Upload complete! Waiting for R2 webhook to trigger processing...")

    def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """Get job status"""
        url: str = f"{self.api_base}/jobs/{job_id}"
        return self._request("GET", url)

    def poll_job(
        self,
        job_id: str,
        poll_interval: int = 5,
        max_wait: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Poll job status until completion or failure"""
        start_time: float = time.time()
        last_status: Optional[str] = None

        print(f"Polling job {job_id}...")
        print(f"   Poll interval: {poll_interval}s")
        if max_wait:
            print(f"   Max wait time: {max_wait}s")

        while True:
            try:
                status: Dict[str, Any] = self.get_job_status(job_id)
                current_status: str = status.get("status", "unknown")

                # Print status change
                if current_status != last_status:
                    elapsed: int = int(time.time() - start_time)
                    print(f"   [{elapsed}s] Status: {current_status}")
                    last_status = current_status

                # Check if job is complete
                if current_status == "completed":
                    print(f"Job completed successfully!")
                    self._print_job_results(status)
                    return status

                if current_status == "failed":
                    error: str = status.get("error", "Unknown error")
                    print(f"Job failed: {error}")
                    return status

                # Check timeout
                if max_wait and (time.time() - start_time) > max_wait:
                    print(f"Timeout after {max_wait}s")
                    return status

                time.sleep(poll_interval)

            except KeyboardInterrupt:
                print("\nPolling interrupted by user")
                sys.exit(1)
            except Exception as e:
                print(f"Error polling job: {e}")
                time.sleep(poll_interval)

    def _print_job_results(self, status: Dict[str, Any]) -> None:
        """Print job results in a readable format"""
        outputs: Optional[List[Dict[str, Any]]] = status.get("outputs")
        if outputs:
            print("\nOutputs:")
            for output in outputs:
                quality: str = output.get("quality", "unknown")
                url: str = output.get("url", "N/A")
                print(f"   • {quality}: {url}")

        timestamps: Dict[str, Any] = status.get("timestamps", {})
        if timestamps:
            print("\nTimestamps:")
            if "createdAt" in timestamps:
                print(f"   Created: {self._format_timestamp(timestamps['createdAt'])}")
            if "uploadedAt" in timestamps:
                print(f"   Uploaded: {self._format_timestamp(timestamps['uploadedAt'])}")
            if "queuedAt" in timestamps:
                print(f"   Queued: {self._format_timestamp(timestamps['queuedAt'])}")
            if "startedAt" in timestamps:
                print(f"   Started: {self._format_timestamp(timestamps['startedAt'])}")
            if "completedAt" in timestamps:
                print(f"   Completed: {self._format_timestamp(timestamps['completedAt'])}")

                # Calculate duration
                if "startedAt" in timestamps:
                    duration: float = (timestamps["completedAt"] - timestamps["startedAt"]) / 1000
                    print(f"   Duration: {duration:.1f}s")

    @staticmethod
    def _format_timestamp(ts: int) -> str:
        """Format timestamp (milliseconds) to readable string"""
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts / 1000))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="TCoder Client Flow - Production transcoding workflow",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument(
        "video_file",
        type=Path,
        help="Path to video file to transcode",
    )

    parser.add_argument(
        "--domain",
        required=True,
        help="Domain of the production API server (e.g., api.example.com)",
    )

    parser.add_argument(
        "--preset",
        default="default",
        choices=["default", "web-optimized", "hls", "hls-adaptive"],
        help="Transcoding preset (default: default)",
    )

    parser.add_argument(
        "--qualities",
        nargs="*",
        help="Output qualities (e.g., 720p 1080p)",
    )

    parser.add_argument(
        "--content-type",
        default="video/mp4",
        help="Content type (default: video/mp4)",
    )

    parser.add_argument(
        "--poll-interval",
        type=int,
        default=5,
        help="Poll interval in seconds (default: 5)",
    )

    parser.add_argument(
        "--max-wait",
        type=int,
        help="Maximum wait time in seconds (default: no limit)",
    )

    args: argparse.Namespace = parser.parse_args()

    if not args.video_file.exists():
        print(f"File not found: {args.video_file}")
        sys.exit(1)

    client: TcoderClient = TcoderClient(base_url=args.domain)

    try:
        # Step 1: Request upload URL
        upload_data: Dict[str, Any] = client.request_upload_url(
            filename=args.video_file.name,
            content_type=args.content_type,
            preset=args.preset,
            output_qualities=args.qualities,
        )
        job_id: str = upload_data["jobId"]
        upload_url: str = upload_data["uploadUrl"]

        # Step 2: Upload file to R2
        client.upload_file(upload_url, args.video_file, args.content_type)

        # Step 3: Poll for completion (R2 webhook will automatically trigger processing)
        client.poll_job(job_id, poll_interval=args.poll_interval, max_wait=args.max_wait)

    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

