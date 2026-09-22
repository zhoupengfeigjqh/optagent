"""pytest 根 conftest：把本目录（服务根）插入 sys.path。

目的：让 `tests/test_jev_core.py` 里的 `import jev_core` 在
`python -m pytest -q tests`（推荐，见 README）与裸 `pytest -q tests` 两种调用下都成立——
不必在测试文件里写 sys.path 手术，也不必让 tests 变成包。
"""
