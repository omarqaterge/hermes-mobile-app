# Runs ON the phone (fed over stdin by tools/e2e.py): replays a real background-review event sequence.
import importlib.util, time
s=importlib.util.spec_from_file_location('hm','/root/.hermes/plugins/hermes-mobile/__init__.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
m._post=lambda e: True
sid='e2e-replay'  # a fake session id: never reuse a real chat's id in tests
main_turn=f'{sid}:{sid}:4016ff1a'
review_turn=f'{sid}:9b120335-f5d0-4dea-a4ce-05b7263d0aa6:5c7c4df6'   # exactly as logged in the real incident
# real turn runs and ends
m._on_stream_start(session_id=sid, turn_id=main_turn)
print('main turn: active =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
m._on_session_end(session_id=sid, turn_id=main_turn, completed=True)
print('after session_end: active =', sid in m._active)
time.sleep(2)   # the review starts ~2 s later, as in the log
m._on_stream_start(session_id=sid, turn_id=review_turn)
print('review start: active =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
m._on_pre_tool_call(tool_name='skills_list', args={}, session_id=sid, turn_id=review_turn)
print('review tool:', m._active[sid]['text'])
m._on_stream_end(final_text='Nothing to save.', session_id=sid, turn_id=review_turn, finished=True)
print('after review final stream_end: active =', sid in m._active)
# a real follow-up turn 20 s later must NOT be treated as a review
time.sleep(0.2)
m._last_end[sid] = time.time() - 20
follow=f'{sid}:{sid}:aaaa1111'
m._on_stream_start(session_id=sid, turn_id=follow)
print('normal follow-up: text =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
# a uuid-task turn that starts long after the last end (e.g. another platform) must NOT be a review either
m._clear_status(sid)
m._last_end[sid] = time.time() - 90
other=f'{sid}:11111111-2222-3333-4444-555555555555:bbbb2222'
m._on_stream_start(session_id=sid, turn_id=other)
print('uuid turn, 90 s after last end: review flag =', m._active[sid]['review'])
# a review whose first hook comes 10 s after the turn ended (it ran the vision tool on a photo first)
m._clear_status(sid)
m._last_end[sid] = time.time() - 10
late=f'{sid}:2859e0e7-fb03-477d-a14c-e8548f1e9906:0c20ee0d'
m._on_stream_start(session_id=sid, turn_id=late)
print('late review start: review flag =', m._active[sid]['review'])
m._on_stream_end(final_text='Nothing to save.', session_id=sid, turn_id=late, finished=True)
print('after late review final stream_end: active =', sid in m._active)

m._clear_status(sid)  # leave nothing behind in the shared activity file
print('cleaned up: active =', m._active)
