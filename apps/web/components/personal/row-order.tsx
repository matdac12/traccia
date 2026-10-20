"use client";
import type { Todo } from "@traccia/shared";
import { createContext, useContext } from "react";

/** The sortable rows of the list on screen, in the order it shows them: what "Move up" and "Move down" step through. */
const RowOrderContext = createContext<Todo[] | null>(null);
export const RowOrderProvider = RowOrderContext.Provider;

/** The rows of the list the caller sits in, or null outside a sortable list (Overdue, the Logbook, the details panel). */
export const useRowOrder = () => useContext(RowOrderContext);
