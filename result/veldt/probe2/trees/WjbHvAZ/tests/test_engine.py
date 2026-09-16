"""Tests for the engine facade, configuration and observability."""

from __future__ import annotations

import logging
import io

import pytest

import veldt
from veldt import Engine, EngineConfig
from veldt.errors import ConfigurationError, TableAlreadyExistsError, TableNotFoundError
from veldt.expr.aggregates import AggregateFunction, Accumulator
from veldt.expr.functions import ScalarFunction
from veldt.observability.logging import configure_logging, get_logger, level_from_name
from veldt.observability.metrics import Counter, MetricsCollector, Timer
from veldt.observability.tracing import Tracer
from veldt.types.dtypes import DataType


class TestPackageSurface:
    def test_exports_a_version(self):
        assert veldt.__version__.count(".") == 2

    def test_the_banner_names_the_package(self):
        assert veldt.version_string().startswith("veldt ")

    def test_the_public_names_are_importable(self):
        for name in veldt.__all__:
            assert hasattr(veldt, name)


class TestConfiguration:
    def test_defaults_are_sane(self):
        config = EngineConfig()
        assert config.batch_size > 0
        assert config.optimize is True

    def test_a_non_positive_batch_size_is_rejected(self):
        with pytest.raises(ConfigurationError):
            EngineConfig(batch_size=0)

    def test_a_zero_iteration_budget_is_rejected(self):
        with pytest.raises(ConfigurationError):
            EngineConfig(max_optimizer_iterations=0)

    def test_relaxed_column_resolution_is_not_implemented(self):
        with pytest.raises(ConfigurationError):
            EngineConfig(fail_on_unknown_column=False)

    def test_replace_returns_a_copy(self):
        config = EngineConfig()
        assert config.replace(batch_size=10).batch_size == 10
        assert config.batch_size != 10

    def test_replacing_an_unknown_setting_is_rejected(self):
        with pytest.raises(ConfigurationError):
            EngineConfig().replace(nope=1)

    def test_round_trips_through_a_dict(self):
        config = EngineConfig(batch_size=64)
        assert EngineConfig.from_dict(config.to_dict()) == config

    def test_unknown_keys_are_rejected_when_loading(self):
        with pytest.raises(ConfigurationError):
            EngineConfig.from_dict({"nope": 1})

    def test_it_describes_itself(self):
        assert "batch_size" in EngineConfig().describe()


class TestEngineRegistration:
    def test_registering_rows(self):
        engine = Engine()
        engine.register_rows("t", [{"a": 1}])
        assert engine.sql("SELECT a FROM t").scalar() == 1

    def test_registering_a_table(self, orders):
        engine = Engine()
        engine.register_table("orders", orders)
        assert engine.schema("orders").names[0] == "id"

    def test_registering_a_csv(self, orders_csv):
        engine = Engine()
        engine.register_csv("orders", orders_csv)
        assert engine.sql("SELECT count(*) FROM orders").scalar() == 6

    def test_registering_jsonl(self, orders_jsonl):
        engine = Engine()
        engine.register_jsonl("orders", orders_jsonl)
        assert engine.sql("SELECT count(*) FROM orders").scalar() == 6

    def test_registering_a_partitioned_directory(self, partitioned_root):
        engine = Engine()
        engine.register_partitioned("events", partitioned_root)
        assert engine.sql("SELECT count(*) FROM events").scalar() == 5

    def test_duplicate_names_need_replace(self, orders):
        engine = Engine()
        engine.register_table("t", orders)
        with pytest.raises(TableAlreadyExistsError):
            engine.register_table("t", orders)
        engine.register_table("t", orders, replace=True)

    def test_dropping_a_table(self, engine):
        assert engine.drop_table("orders") is True
        with pytest.raises(TableNotFoundError):
            engine.sql("SELECT * FROM orders")

    def test_tables_are_listed_alphabetically(self, engine):
        assert engine.tables() == ["customers", "orders"]

    def test_registration_is_chainable(self, orders):
        engine = Engine().register_table("a", orders).register_table("b", orders)
        assert len(engine.tables()) == 2


class TestEngineExtension:
    def test_custom_scalar_functions(self, engine):
        engine.register_function(
            ScalarFunction("shout", lambda text: str(text).upper() + "!", DataType.STRING)
        )
        assert engine.sql("SELECT shout(region) AS s FROM orders LIMIT 1").scalar() == "EU!"

    def test_custom_aggregates(self, engine):
        class Product(Accumulator):
            def __init__(self):
                self.value = 1
                self.seen = False

            def update(self, value):
                if value is not None:
                    self.value *= value
                    self.seen = True

            def merge(self, other):
                self.value *= other.value

            def finalize(self):
                return self.value if self.seen else None

        engine.register_aggregate(
            AggregateFunction("product", lambda types: Product(), DataType.INT64)
        )
        assert engine.sql("SELECT product(id) AS p FROM orders").scalar() == 720

    def test_configuration_can_be_swapped(self, engine):
        assert engine.with_config(batch_size=8).config.batch_size == 8
        assert engine.config.batch_size != 8

    def test_a_swapped_engine_shares_the_catalog(self, engine):
        assert engine.with_config(batch_size=8).tables() == engine.tables()


class TestEngineCaching:
    def test_the_cache_is_off_by_default(self, engine):
        engine.table("orders")
        assert len(engine.cache) == 0

    def test_enabling_the_cache_stores_tables(self, orders_csv):
        engine = Engine(config=EngineConfig(cache_enabled=True))
        engine.register_csv("orders", orders_csv)
        first = engine.table("orders")
        assert engine.table("orders") is first

    def test_re_registering_invalidates_the_cache(self, orders_csv, orders):
        engine = Engine(config=EngineConfig(cache_enabled=True))
        engine.register_csv("orders", orders_csv)
        engine.table("orders")
        engine.register_table("orders", orders, replace=True)
        assert len(engine.cache) == 0


class TestMetrics:
    def test_counters_only_increase(self):
        with pytest.raises(ValueError):
            Counter("c").increment(-1)

    def test_counters_merge(self):
        assert Counter("c", 2).merge(Counter("c", 3)).value == 5

    def test_timers_average_their_observations(self):
        timer = Timer("t")
        timer.record(1.0)
        timer.record(3.0)
        assert timer.average_seconds == 2.0
        assert timer.milliseconds == 4000.0

    def test_the_collector_creates_metrics_on_demand(self):
        collector = MetricsCollector()
        collector.increment("rows", 3)
        assert collector.counter("rows") == 3
        assert collector.counter_names() == ["rows"]

    def test_the_timer_context_records_even_on_failure(self):
        collector = MetricsCollector()
        with pytest.raises(RuntimeError):
            with collector.timer("work"):
                raise RuntimeError("boom")
        assert "work" in collector.timer_names()

    def test_a_disabled_collector_records_nothing(self):
        collector = MetricsCollector(enabled=False)
        collector.increment("rows")
        with collector.timer("work"):
            pass
        assert collector.snapshot().counters == {}

    def test_collectors_merge(self):
        left, right = MetricsCollector(), MetricsCollector()
        left.increment("rows", 1)
        right.increment("rows", 2)
        assert left.merge(right).counter("rows") == 3

    def test_snapshots_render_timers_in_milliseconds(self):
        collector = MetricsCollector()
        collector.record("work", 0.5)
        assert collector.to_dict()["work_ms"] == 500.0

    def test_reset_clears_everything(self):
        collector = MetricsCollector()
        collector.increment("rows")
        collector.reset()
        assert collector.counter("rows") == 0


class TestTracing:
    def test_spans_nest(self):
        tracer = Tracer()
        with tracer.span("outer"):
            with tracer.span("inner"):
                pass
        assert tracer.roots[0].children[0].name == "inner"

    def test_spans_close_even_on_failure(self):
        tracer = Tracer()
        with pytest.raises(RuntimeError):
            with tracer.span("work"):
                raise RuntimeError("boom")
        assert tracer.roots[0].is_open is False

    def test_attributes_are_recorded(self):
        tracer = Tracer()
        with tracer.span("scan", table="orders") as span:
            span.set(rows=6)
        assert tracer.roots[0].attributes == {"table": "orders", "rows": 6}

    def test_a_disabled_tracer_records_nothing(self):
        tracer = Tracer(enabled=False)
        with tracer.span("work"):
            pass
        assert tracer.roots == []

    def test_the_trace_renders_as_a_tree(self):
        tracer = Tracer()
        with tracer.span("outer"):
            with tracer.span("inner"):
                pass
        rendered = tracer.render()
        assert rendered.splitlines()[1].startswith("  inner")

    def test_an_empty_trace_says_so(self):
        assert "no spans" in Tracer().render()

    def test_tracing_can_be_switched_on_for_a_query(self, engine):
        traced = engine.with_config(enable_tracing=True)
        context = traced.context()
        traced.execute(traced.plan("SELECT id FROM orders"), metrics=context.metrics, tracer=context.tracer)
        assert len(context.tracer.spans()) > 0


class TestLogging:
    def test_named_loggers_live_under_the_package(self):
        assert get_logger("sql").name == "veldt.sql"

    def test_the_root_logger_is_returned_by_default(self):
        assert get_logger().name == "veldt"

    def test_level_names_resolve(self):
        assert level_from_name("debug") == logging.DEBUG

    def test_unknown_level_names_are_rejected(self):
        with pytest.raises(ValueError):
            level_from_name("chatty")

    def test_configuring_twice_does_not_duplicate_handlers(self):
        first = configure_logging(logging.INFO, io.StringIO())
        count = len([h for h in first.handlers if not isinstance(h, logging.NullHandler)])
        second = configure_logging(logging.INFO, io.StringIO())
        assert len([h for h in second.handlers if not isinstance(h, logging.NullHandler)]) == count
