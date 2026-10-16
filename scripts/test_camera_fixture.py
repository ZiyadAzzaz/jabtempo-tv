"""Privacy/provenance regression tests; no camera or FFmpeg process executes."""
import json
from pathlib import Path
from unittest.mock import patch
import pytest
import prepare_camera_fixture as fixture

def configured(tmp_path):
    private=tmp_path/'local_private';private.mkdir()
    env=tmp_path/'env';env.mkdir()
    binary=env/'ffmpeg.exe';binary.touch()
    return private,binary

def test_external_output_rejected_before_tool_execution(tmp_path):
    with patch.object(fixture,'ROOT',tmp_path), patch.object(fixture.subprocess,'run') as run:
        with pytest.raises(ValueError,match='local_private'):
            fixture.prepare(tmp_path/'outside.y4m')
        run.assert_not_called()

def test_video_requires_matching_private_consent_and_exact_hash(tmp_path,monkeypatch):
    private,binary=configured(tmp_path);monkeypatch.setenv('CONDA_PREFIX',str(binary.parent))
    video=private/'clip.webm';video.write_bytes(b'private-unit-fixture-not-real-media')
    manifest=private/'consent.json';manifest.write_text(json.dumps({'synthetic':False,'consent':{'localVideoTesting':True},'videoSha256':'wrong'}))
    with patch.object(fixture,'ROOT',tmp_path),patch.object(fixture.shutil,'which',return_value=str(binary)),patch.object(fixture.subprocess,'run') as run:
        with pytest.raises(ValueError,match='exact video SHA256'):fixture.prepare(private/'clip.y4m',video,manifest)
        run.assert_not_called()
        manifest.write_text(json.dumps({'synthetic':False,'consent':{'localVideoTesting':False}}))
        with pytest.raises(ValueError,match='consent'):fixture.prepare(private/'clip.y4m',video,manifest)
        external=tmp_path/'external.json';external.write_text('{}')
        with pytest.raises(ValueError,match='manifest must'):fixture.prepare(private/'clip.y4m',video,external)

def test_system_ffmpeg_and_unbounded_conversion_refused(tmp_path,monkeypatch):
    private,binary=configured(tmp_path);monkeypatch.setenv('CONDA_PREFIX',str(binary.parent))
    with patch.object(fixture,'ROOT',tmp_path),patch.object(fixture.shutil,'which',return_value=str(tmp_path/'system.exe')):
        with pytest.raises(ValueError,match='system ffmpeg'):fixture.prepare(private/'clip.y4m')
        with pytest.raises(ValueError,match='bounded'):fixture.prepare(private/'clip.y4m',duration=3600)
