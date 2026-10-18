"use client";
import type { ProjectOption } from "@traccia/shared";
import { createContext, useContext } from "react";

const ProjectOptionsContext = createContext<readonly ProjectOption[]>([]);

/** The live Projects the Personal Space offers in `@` autocomplete and names on chip tooltips. */
export const ProjectOptionsProvider = ProjectOptionsContext;

export const useProjectOptions = () => useContext(ProjectOptionsContext);
