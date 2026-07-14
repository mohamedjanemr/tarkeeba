"""Tests for multimodal Insights queries."""

from runners.insights_runner import build_user_message


def test_build_user_message_includes_images_before_text():
    message = build_user_message(
        "Describe the screenshot",
        [
            {
                "media_type": "image/png",
                "data": "c2NyZWVuc2hvdA==",
                "path": "/tmp/screenshot.png",
            }
        ],
    )

    assert message == {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": "c2NyZWVuc2hvdA==",
                    },
                },
                {"type": "text", "text": "Describe the screenshot"},
            ],
        },
        "parent_tool_use_id": None,
    }


def test_build_user_message_supports_multiple_images():
    message = build_user_message(
        "Compare these",
        [
            {"media_type": "image/jpeg", "data": "Zmlyc3Q=", "path": "/tmp/1.jpg"},
            {"media_type": "image/webp", "data": "c2Vjb25k", "path": "/tmp/2.webp"},
        ],
    )

    content = message["message"]["content"]
    assert [block["type"] for block in content] == ["image", "image", "text"]
    assert content[-1]["text"] == "Compare these"
