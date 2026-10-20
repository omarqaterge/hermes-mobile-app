# Runs ON the phone (fed over stdin by tools/e2e.py): replays real background-work event sequences (the
# memory/skills review after a reply, /btw side questions), with the turn ids as Hermes logs them.
# Each hook runs under the write origin Hermes binds for that kind of turn, the way Hermes calls plugin hooks.
import contextvars, importlib.util, time
s=importlib.util.spec_from_file_location('hm','/root/.hermes/plugins/hermes-mobile/__init__.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
m._post=lambda e: True
try:
    from tools.skill_provenance import set_current_write_origin
    print('origin source: hermes')
except Exception:  # not inside Hermes's venv: stand in for its ContextVar
    _o = contextvars.ContextVar('o', default='')
    set_current_write_origin = _o.set
    m._write_origin = lambda: _o.get()
    print('origin source: stub')


def as_(origin, fn, **kw):
    def run():
        set_current_write_origin(origin)
        fn(**kw)
    contextvars.copy_context().run(run)


sid='e2e-replay'  # a fake session id: never reuse a real chat's id in tests
main_turn=f'{sid}:{sid}:4016ff1a'
review_turn=f'{sid}:9b120335-f5d0-4dea-a4ce-05b7263d0aa6:5c7c4df6'   # exactly as logged in the real incident
# real turn runs and ends
as_('assistant_tool', m._on_stream_start, session_id=sid, turn_id=main_turn)
print('main turn: active =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
as_('assistant_tool', m._on_session_end, session_id=sid, turn_id=main_turn, completed=True)
print('after session_end: active =', sid in m._active)
# the review starts 90 s later (it can run the vision tool on photos first): no time window any more
m._last_end[sid] = time.time() - 90
as_('background_review', m._on_stream_start, session_id=sid, turn_id=review_turn)
print('review start: active =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
as_('background_review', m._on_pre_tool_call, tool_name='skills_list', args={}, session_id=sid, turn_id=review_turn)
print('review tool:', m._active[sid]['text'])
as_('background_review', m._on_stream_end, final_text='Nothing to save.', session_id=sid, turn_id=review_turn, finished=True)
print('after review final stream_end: active =', sid in m._active)
# a real turn whose task id is a uuid (another platform) right after a turn ended is NOT background work
m._last_end[sid] = time.time()
other=f'{sid}:11111111-2222-3333-4444-555555555555:bbbb2222'
as_('assistant_tool', m._on_stream_start, session_id=sid, turn_id=other)
print('uuid-task real turn: text =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
# a /btw asked while that turn runs must not replace or clear the turn's status
btw1=f'{sid}:22222222-3333-4444-5555-666666666666:cccc3333'
as_('side_question', m._on_stream_start, session_id=sid, turn_id=btw1)
as_('side_question', m._on_stream_end, final_text='Yes.', session_id=sid, turn_id=btw1, finished=True)
print('btw during a turn: text =', m._active.get(sid, {}).get('text'))
as_('assistant_tool', m._on_session_end, session_id=sid, turn_id=other, completed=True)
# a /btw while the chat is idle shows as a side question and clears when it ends
btw2=f'{sid}:33333333-4444-5555-6666-777777777777:dddd4444'
as_('side_question', m._on_stream_start, session_id=sid, turn_id=btw2)
print('btw while idle: text =', m._active[sid]['text'], '| review flag =', m._active[sid]['review'])
as_('side_question', m._on_stream_end, final_text='Yes.', session_id=sid, turn_id=btw2, finished=True)
print('after btw final stream_end: active =', sid in m._active)

m._clear_status(sid)  # leave nothing behind in the shared activity file
print('cleaned up: active =', m._active)
