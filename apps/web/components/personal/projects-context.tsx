"use client";
import { createContext, useContext } from "react";
import type { ProjectOption } from "@/lib/personal/project-autocomplete";

const ProjectOptionsContext = createContext<readonly ProjectOption[]>([]);

/** The live Projects the Personal Space offers in `@` autocomplete and names on chip tooltips. */
export const ProjectOptionsProvider = ProjectOptionsContext;

export const useProjectOptions = () => useContext(ProjectOptionsContext);
