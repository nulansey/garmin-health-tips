import json

from web import chat


def test_chat_history_roundtrip_and_trim(tmp_path):
    p = tmp_path / "chat.json"
    assert chat.load_chat(p) == []
    turns = [{"role": "user", "text": f"m{i}", "ts": "2026-07-08T10:00:00"}
             for i in range(chat.MAX_TURNS + 50)]
    chat.save_chat(turns, path=p)
    loaded = chat.load_chat(p)
    assert len(loaded) == chat.MAX_TURNS
    assert loaded[-1]["text"] == f"m{chat.MAX_TURNS + 49}"


def test_build_chat_prompt_contents():
    context = {"today_weekday": "Wednesday", "weekday_averages_weighted": {}}
    history = [{"role": "user", "text": "how did I sleep?", "ts": "t"},
               {"role": "coach", "text": "pretty well", "ts": "t"}]
    tips = [{"date": "2026-07-08", "slot": "morning", "text": "Aim for ~2,050"}]
    config = {"tone": "friendly", "goal": {"type": "deficit", "amount": 500},
              "targets": {"steps": 10000}}
    prompt = chat.build_chat_prompt("what about today?", history, context,
                                    tips, config, calorie_target_value=2050)
    assert "what about today?" in prompt
    assert "how did I sleep?" in prompt          # history included
    assert "2,050" in prompt                     # calorie target included
    assert "10,000" in prompt                    # targets included
    assert "Aim for ~2,050" in prompt            # recent tips included
    assert "friendly" in prompt                  # tone included
