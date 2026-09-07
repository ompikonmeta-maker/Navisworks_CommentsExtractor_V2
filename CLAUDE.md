# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository is a new, empty project. As of this writing it contains only `README.md`; there is no source code, build configuration, dependency manifest, or tests yet.

The project name (`Navisworks_CommentsExtractor_V1`) indicates the intended purpose: a tool to extract comments from Autodesk Navisworks. Navisworks tooling is typically built as a .NET plugin/add-in against the Navisworks .NET API (`Autodesk.Navisworks.Api`), but no implementation choices have been committed here yet — do not assume a stack until code or a project/config file establishes one.

## For future instances

When real code lands, replace this section with:
- Build / run / test / lint commands (including how to run a single test).
- The big-picture architecture that spans multiple files.

Until then, inspect the working tree (`git status`, `ls`) before acting — this file will lag behind the first real commits.
