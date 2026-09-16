#!/bin/bash
cd /root/mindriftwork/AQ_dragan/result/sagemark-48bf/work
HARNESS_APP=$PWD HARNESS_SHIM=/root/mindriftwork/AQ_dragan/result/sagemark-48bf/tasks/adventuring-day-plan/harness/shim.mjs HARNESS_HOOKS=/root/mindriftwork/AQ_dragan/result/sagemark-48bf/tasks/adventuring-day-plan/harness/hooks.mjs \
  node --experimental-transform-types --disable-warning=ExperimentalWarning --import /root/mindriftwork/AQ_dragan/result/sagemark-48bf/tasks/adventuring-day-plan/harness/register.mjs "$@"
