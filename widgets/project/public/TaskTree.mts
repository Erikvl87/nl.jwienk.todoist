/** Minimal Todoist task shape as returned by the Todoist API. */
export type TodoistTask = {
  id: string;
  parent_id: string | null;
  section_id: string | null;
  child_order: number;
  content: string;
  updated_at: string;
};

/** Shape of the project payload returned by the Homey Todoist driver. */
export type TodoistProjectResponse = {
  project: TodoistProject;
  sections?: Array<Omit<TodoistSection, 'tasks'>>;
  tasks?: TodoistTask[];
};

/** Task node augmented with children and depth for rendering nested subtasks. */
export type TodoistTaskNode = TodoistTask & {
  children: TodoistTaskNode[];
  depth: number;
};

/** Todoist section structure used within the widget. */
export type TodoistSection = {
  id: string;
  name: string;
  section_order: number;
  updated_at: string;
  tasks: TodoistTaskNode[];
};

/** Section payload shape when no tasks are attached (e.g., realtime events). */
export type TodoistSectionInput = Omit<TodoistSection, 'tasks'>;

/** Shape of a Todoist project used within the widget. */
export type TodoistProject = {
  name: string;
  [key: string]: unknown;
};

/** Organized project data structure ready for rendering. */
export type OrganizedProjectData = {
  project: TodoistProject | null;
  sections: TodoistSection[];
  unsectioned: TodoistTaskNode[];
};

type TaskTreeHooks = {
  /** Called after a task element is rendered. */
  onTaskAdd?: (element: HTMLElement, taskId: string) => void;
  /** Called before a task is removed. Invoke done() when the transition is finished. */
  onTaskRemove?: (element: HTMLElement, done: () => void) => void;
  /** Called after a section element is rendered. */
  onSectionAdd?: (element: HTMLElement) => void;
  /** Called before a section is removed. Invoke done() when the transition is finished. */
  onSectionRemove?: (element: HTMLElement, done: () => void) => void;
  /** Called when a task checkbox is clicked. */
  onTaskCheckboxClick?: (taskId: string, element: HTMLElement) => void;
  /** Called after the tree has finished rendering. */
  onTreeChange?: () => void;
};

/** Internal section record used by the store. */
type SectionRecord = {
  id: string;
  name: string;
  section_order: number;
  updated_at: string;
};

/** Holds normalized project data and builds render-ready snapshots. */
class TaskStore {
  private project: TodoistProject | null = null;
  private sections = new Map<string, SectionRecord>();
  private tasks = new Map<string, TodoistTask>();

  /** Returns true if incoming updated_at is older than current. */
  private isStale(incoming: string, current: string): boolean {
    const incomingTime = Date.parse(incoming);
    const currentTime = Date.parse(current);
    if (Number.isNaN(incomingTime) || Number.isNaN(currentTime)) return false;
    return incomingTime < currentTime;
  }

  /** Normalizes incoming project payload into maps. */
  public organize(data: TodoistProjectResponse): void {
    this.project = data.project ?? null;
    this.sections.clear();
    (data.sections ?? []).forEach((section) => {
      this.sections.set(section.id, {
        id: section.id,
        name: section.name,
        section_order: section.section_order,
        updated_at: section.updated_at,
      });
    });

    this.tasks.clear();
    (data.tasks ?? []).forEach((task) => {
      this.tasks.set(task.id, { ...task });
    });
  }

  /**
   * Replaces a task if it exists. Ordering is derived from incoming child_order values
   * and applied during snapshot rendering; we do not mutate sibling orders here.
   */
  public updateTask(updatedTask: TodoistTask): void {
    const existing = this.tasks.get(updatedTask.id);
    if (!existing)
      throw new Error(`Task with ID ${updatedTask.id} does not exist.`);

    if (this.isStale(updatedTask.updated_at, existing.updated_at)) {
      console.warn('[TaskTree] stale task update skipped', {
        id: updatedTask.id,
        incoming: updatedTask.updated_at,
        current: existing.updated_at,
      });
      return;
    }

    this.tasks.set(updatedTask.id, { ...updatedTask });
  }

  /** Adds a new task to the store. */
  public addTask(task: TodoistTask): void {
    if (this.tasks.has(task.id)) throw new Error(`Task with ID ${task.id} already exists.`);
    this.tasks.set(task.id, { ...task });
  }

  /** Adds or updates a section. */
  public addSection(section: TodoistSectionInput): void {
    this.sections.set(section.id, {
      id: section.id,
      name: section.name,
      section_order: section.section_order,
      updated_at: section.updated_at,
    });
  }

  /** Updates a section if it already exists. */
  public updateSection(section: TodoistSectionInput): { skipped: boolean } {
    const existing = this.sections.get(section.id);
    if (!existing)
      throw new Error(`Section with ID ${section.id} does not exist.`);

    if (this.isStale(section.updated_at, existing.updated_at)) {
      console.warn('[TaskTree] stale section update skipped', {
        id: section.id,
        incoming: section.updated_at,
        current: existing.updated_at,
      });
      return { skipped: true };
    }

    this.sections.set(section.id, {
      id: section.id,
      name: section.name,
      section_order: section.section_order,
      updated_at: section.updated_at,
    });

    return { skipped: false };
  }

  /** Removes a task and its descendants. */
  public removeTask(taskId: string): void {
    if (!this.tasks.has(taskId)) return;

    const queue = [taskId];
    while (queue.length) {
      const current = queue.shift()!;
      this.tasks.delete(current);
      for (const task of this.tasks.values()) {
        if (task.parent_id === current) {
          queue.push(task.id);
        }
      }
    }
  }

  /** Removes a section and all tasks rooted in it. */
  public removeSection(sectionId: string): void {
    if (!this.sections.has(sectionId)) return;

    const roots = Array.from(this.tasks.values()).filter((task) => task.section_id === sectionId);
    roots.forEach((task) => this.removeTask(task.id));

    this.sections.delete(sectionId);
  }

  /** Builds a render-ready tree snapshot with depths and ordering. */
  public snapshot(): OrganizedProjectData {
    const sortByOrder = (a: TodoistTaskNode, b: TodoistTaskNode) =>
      a.child_order === b.child_order ? a.id.localeCompare(b.id) : a.child_order - b.child_order;

    const nodes = new Map<string, TodoistTaskNode>();
    this.tasks.forEach((task) => {
      nodes.set(task.id, { ...task, children: [], depth: 0 });
    });

    const roots: TodoistTaskNode[] = [];
    nodes.forEach((node) => {
      const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    const assignDepth = (node: TodoistTaskNode, depth: number) => {
      node.depth = depth;
      node.children.forEach((child) => assignDepth(child, depth + 1));
    };
    roots.forEach((root) => assignDepth(root, 0));

    nodes.forEach((node) => node.children.sort(sortByOrder));

    const sectionTasks = new Map<string, TodoistTaskNode[]>();
    roots.forEach((root) => {
      if (root.section_id && this.sections.has(root.section_id)) {
        if (!sectionTasks.has(root.section_id)) {
          sectionTasks.set(root.section_id, []);
        }
        sectionTasks.get(root.section_id)!.push(root);
      }
    });

    const unsectioned = roots.filter((root) => !root.section_id).sort(sortByOrder);

    const sections = Array.from(this.sections.values())
      .sort((a, b) => a.section_order - b.section_order)
      .map((section) => ({
        ...section,
        tasks: (sectionTasks.get(section.id) ?? []).sort(sortByOrder),
      }));

    return { project: this.project, sections, unsectioned };
  }
}

/** Renders snapshots into the DOM. */
class TaskView {
  private rootElement: HTMLElement;
  private pendingTaskAddIds: Set<string> = new Set();
  private pendingSectionAddIds: Set<string> = new Set();
  private hooks?: TaskTreeHooks;
  private allowCompletingTasks: boolean;

  /**
   * Sets up the view with a root element reference.
   */
  constructor(rootElement: HTMLElement, hooks?: TaskTreeHooks, allowCompletingTasks = true) {
    this.rootElement = rootElement;
    this.hooks = hooks;
    this.allowCompletingTasks = allowCompletingTasks;
  }

  /** Marks tasks that should render hidden initially (for enter animations). */
  public setPendingTaskAddIds(ids: Set<string>): void {
    this.pendingTaskAddIds = new Set(ids);
  }

  /** Marks sections that should render hidden initially (for enter animations). */
  public setPendingSectionAddIds(ids: Set<string>): void {
    this.pendingSectionAddIds = new Set(ids);
  }

  /**
   * Renders the full tree (sections and unsectioned) into the root.
   */
  public render(data: OrganizedProjectData): void {
    this.rootElement.innerHTML = '';

    const fragment = document.createDocumentFragment();

    const unsectionedContainer = document.createElement('div');
    unsectionedContainer.className = 'tasks';
    this.appendTasks(data.unsectioned, unsectionedContainer);
    fragment.appendChild(unsectionedContainer);

    data.sections.forEach((section) => {
      fragment.appendChild(this.renderSection(section));
    });

    this.rootElement.appendChild(fragment);
  }

  /** Creates a section block with its tasks. */
  private renderSection(section: TodoistSection): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'section';
    wrapper.dataset.sectionId = section.id;

    if (this.pendingSectionAddIds.has(section.id)) {
      wrapper.classList.add('fading-out');
    }

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = section.name;

    const tasks = document.createElement('div');
    tasks.className = 'tasks';
    this.appendTasks(section.tasks, tasks);

    wrapper.append(title, tasks);
    return wrapper;
  }

  /** Appends task elements (and their children) into a container. */
  private appendTasks(tasks: TodoistTaskNode[], container: HTMLElement | DocumentFragment): void {
    tasks.forEach((task) => {
      const el = this.createTaskElement(task);
      container.appendChild(el);
      if (task.children.length) {
        const subtasks = el.querySelector<HTMLDivElement>('.subtasks');
        if (subtasks) {
          this.appendTasks(task.children, subtasks);
        }
      }
    });
  }

  /** Builds a single task row element. */
  private createTaskElement(task: TodoistTaskNode): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'task';
    el.style.setProperty('--indent', task.depth.toString());
    el.dataset.taskId = task.id;

    if (this.pendingTaskAddIds.has(task.id)) {
      el.classList.add('fading-out');
    }

    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'checkbox';
    const onTaskCheckboxClick = this.hooks?.onTaskCheckboxClick;

    if (!this.allowCompletingTasks) {
      checkbox.classList.add('disabled');
      el.classList.add('disabled');
      checkbox.disabled = true;
      checkbox.setAttribute('aria-disabled', 'true');
    } else if (onTaskCheckboxClick) {
      checkbox.addEventListener('click', () => {
        onTaskCheckboxClick(task.id, el);
      });
    }

    const content = document.createElement('div');
    content.className = 'task-content';
    content.textContent = task.content;

    const row = document.createElement('div');
    row.className = 'task-row';
    row.append(checkbox, content);

    const subtasks = document.createElement('div');
    subtasks.className = 'subtasks';

    el.append(row, subtasks);
    return el;
  }

  /** Find a task element by id in the current DOM. */
  public findTaskElement(taskId: string): HTMLElement | null {
    return this.rootElement.querySelector(`[data-task-id="${taskId}"]`);
  }

  /** Find a section element by id in the current DOM. */
  public findSectionElement(sectionId: string): HTMLElement | null {
    return this.rootElement.querySelector(`[data-section-id="${sectionId}"]`);
  }

  /** Expose root element for consumers that need it. */
  public getRoot(): HTMLElement {
    return this.rootElement;
  }
}

/** Coordinates store and view, keeping the public API stable. */
export class TaskTree {
  private store = new TaskStore();
  private view: TaskView;
  private renderTimer: number | null = null;
  private pendingSnapshot: OrganizedProjectData | null = null;
  private afterRenderCallbacks: Array<() => void> = [];
  private readonly renderDelayMs = 150;
  private hooks?: TaskTreeHooks;
  private pendingTaskAddIds: Set<string> = new Set();
  private pendingSectionAddIds: Set<string> = new Set();
  private animationsInProgress = 0;
  private isRendering = false;

  /**
   * Initializes the TaskTree facade with a root element.
   */
  constructor(rootElement: HTMLElement, allowCompletingTasks: boolean, hooks?: TaskTreeHooks) {
    this.view = new TaskView(rootElement, hooks, allowCompletingTasks);
    this.hooks = hooks;
  }

  /** Ingests a full project payload and renders it. */
  public organize(data: TodoistProjectResponse): void {
    this.store.organize(data);
    this.queueRender(this.store.snapshot());
  }

  /** Removes a task (and descendants) then re-renders. */
  public removeTask(taskId: string): void {
    const element = this.view.findTaskElement(taskId);
    
    // Remove from store immediately to prevent race conditions
    this.store.removeTask(taskId);

    if (element && this.hooks?.onTaskRemove) {
      this.animationsInProgress++;
      this.hooks.onTaskRemove(element, () => {
        this.animationsInProgress--;
        this.queueRender(this.store.snapshot());
      });
      return;
    }

    this.queueRender(this.store.snapshot());
  }

  /** Adds a task then re-renders. */
  public addTask(task: TodoistTask): void {
    this.store.addTask(task);
    this.pendingTaskAddIds.add(task.id);
    const taskId = task.id;
    this.queueRender(this.store.snapshot(), false, () => {
      const element = this.view.findTaskElement(taskId);
      if (element && this.hooks?.onTaskAdd) {
        this.hooks.onTaskAdd(element, taskId);
      }
      this.pendingTaskAddIds.delete(taskId);
    });
  }

  /** Adds or updates a section then re-renders. */
  public addSection(section: TodoistSectionInput): void {
    this.store.addSection(section);
    this.pendingSectionAddIds.add(section.id);
    const sectionId = section.id;
    this.queueRender(this.store.snapshot(), false, () => {
      const element = this.view.findSectionElement(sectionId);
      if (element && this.hooks?.onSectionAdd) {
        this.hooks.onSectionAdd(element);
      }
      this.pendingSectionAddIds.delete(sectionId);
    });
  }

  /** Updates an existing section and re-renders unless skipped. */
  public updateSection(section: TodoistSectionInput): void {
    const result = this.store.updateSection(section);
    if (result.skipped) return;
    this.queueRender(this.store.snapshot());
  }

  /** Removes a section and its tasks then re-renders. */
  public removeSection(sectionId: string): void {
    const element = this.view.findSectionElement(sectionId);
    
    // Remove from store immediately to prevent race conditions
    this.store.removeSection(sectionId);

    if (element && this.hooks?.onSectionRemove) {
      this.animationsInProgress++;
      this.hooks.onSectionRemove(element, () => {
        this.animationsInProgress--;
        this.queueRender(this.store.snapshot());
      });
      return;
    }

    this.queueRender(this.store.snapshot());
  }

  /** Updates an existing task then re-renders unless skipped. */
  public updateTask(updatedTask: TodoistTask): void {
    this.store.updateTask(updatedTask);
    this.queueRender(this.store.snapshot());
  }

  /** Debounced render to batch bursts of updates. */
  private queueRender(snapshot: OrganizedProjectData, immediate = false, afterRender?: () => void): void {
    this.pendingSnapshot = snapshot;
    if (afterRender) this.afterRenderCallbacks.push(afterRender);

    // Don't start a new render cycle if one is already in progress
    if (this.isRendering || this.animationsInProgress > 0) {
      return;
    }

    if (immediate) {
      if (this.renderTimer !== null) {
        window.clearTimeout(this.renderTimer);
        this.renderTimer = null;
      }
      this.flushRender();
      return;
    }

    if (this.renderTimer !== null) return;

    this.renderTimer = window.setTimeout(() => {
      this.flushRender();
      this.renderTimer = null;
    }, this.renderDelayMs);
  }

  /** Applies the pending snapshot and runs queued callbacks. */
  private flushRender(): void {
    if (!this.pendingSnapshot) return;
    
    // Wait for animations to complete before rendering
    if (this.animationsInProgress > 0) {
      if (this.renderTimer === null) {
        this.renderTimer = window.setTimeout(() => {
          this.renderTimer = null;
          this.flushRender();
        }, 50);
      }
      return;
    }

    this.isRendering = true;
    this.view.setPendingTaskAddIds(this.pendingTaskAddIds);
    this.view.setPendingSectionAddIds(this.pendingSectionAddIds);
    this.view.render(this.pendingSnapshot);
    this.pendingSnapshot = null;
    const callbacks = this.afterRenderCallbacks.splice(0, this.afterRenderCallbacks.length);
    callbacks.forEach((cb) => cb());
    this.isRendering = false;

    if (this.hooks?.onTreeChange) {
      this.hooks.onTreeChange();
    }
    
    // Check if another render was queued while we were rendering
    if (this.pendingSnapshot) {
      this.queueRender(this.pendingSnapshot);
    }
  }
}
