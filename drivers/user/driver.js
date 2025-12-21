'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class UserDriver extends OAuth2Driver {
  /**
   * @override
   * @return {Promise<void>}
   */
  async onOAuth2Init() {
    this.eventTaskDeviceTriggerCard = this.homey.flow.getDeviceTriggerCard('trigger_event_task');

    this.projectTasksFetchedDeviceTriggerCard = this.homey.flow.getDeviceTriggerCard(
      'trigger_project_tasks_fetched'
    );

    this.registerEventTaskDeviceTrigger();
    this.registerProjectTasksFetchedDeviceTrigger();

    this.registerTaskExistsCondition();

    this.registerProjectTaskAction();
    this.registerProjectDueStringTaskAction();
    this.registerProjectDueDateTaskAction();
    this.registerProjectDueDateDueTimeTaskAction();

    this.registerFetchProjectTasksAction();
    this.registerCompleteTasksAction();
  }

  registerCompleteTasksAction() {
    const actionCompleteTasks = this.homey.flow.getActionCard('action_complete_tasks');

    actionCompleteTasks.registerRunListener(async (args, state) => {
      if (args.filter.trim() === '') {
        throw new Error(this.homey.__('invalidFilter'));
      }

      let filter = `search: ${args.filter}`;
      if (args.project?.id) {
        const projectData = { project_id: args.project.id };
        const project = await args.device.oAuth2Client.getProject(projectData).catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, projectData, (updated) =>
            args.device.oAuth2Client.getProject(updated)
          )
        );
        filter += ` & #${project.name}`;
      }

      const tasks = await args.device.oAuth2Client.getTasksByFilter({
        filter,
      });

      this.log(tasks);

      await Promise.all(tasks.map(async task => {
        await args.device.oAuth2Client.closeTask(task.id);
      }));
    });

    actionCompleteTasks.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );
  }

  /**
   * @override
   * @param oAuth2Client
   * @return {Promise<{data: {id}, name: string}[]>}
   */
  async onPairListDevices({ oAuth2Client }) {
    const result = await oAuth2Client.syncUser();
    this.log(result.user);

    return [
      {
        name: result.user.full_name,
        data: {
          id: result.user.id,
        },
      },
    ];
  }

  onWebhookEvent({ body }) {
    const device = this.getDevice({ id: body.user_id });
    const homeyEventName = `${body.user_id}:${body.event_data.project_id}`;
    this.homey.api.realtime(homeyEventName, body);
    this.eventTaskDeviceTriggerCard.trigger(
      device,
      { content: body.event_data.content },
      { event_name: body.event_name }
    );
  }

  registerEventTaskDeviceTrigger() {
    this.eventTaskDeviceTriggerCard.registerRunListener(async (args, state) => {
      if (args.event_name === state.event_name) {
        return true;
      }

      return false;
    });
  }

  registerProjectTasksFetchedDeviceTrigger() {
    this.projectTasksFetchedDeviceTriggerCard.registerRunListener(async (args, state) => {
      if (args.project.id === state.project_id) {
        return true;
      }

      return false;
    });

    this.projectTasksFetchedDeviceTriggerCard.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );
  }

  registerTaskExistsCondition() {
    const conditionTaskExists = this.homey.flow.getConditionCard('condition_task_exists');

    conditionTaskExists.registerRunListener(async (args, state) => {
      let filter = `search: ${args.filter}`;
      if (args.project?.id) {
        const projectData = { project_id: args.project.id };
        const project = await args.device.oAuth2Client.getProject(projectData).catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, projectData, (updated) =>
            args.device.oAuth2Client.getProject(updated)
          )
        );
        filter += ` & #${project.name}`;
      }

      const tasks = await args.device.oAuth2Client.getTasksByFilter({
        filter
      });

      if (tasks.length > 0) {
        return true;
      }

      return false;
    });

    conditionTaskExists.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );
  }

  registerProjectTaskAction() {
    const actionProjectTask = this.homey.flow.getActionCard('action_project_task');

    actionProjectTask.registerRunListener(async (args, state) => {
      const taskData = {
        content: args.content,
        project_id: args.project.id,
        priority: args.priority,
        assignee_id: args.assignee?.id,
      };

      await args.device.oAuth2Client
        .createTask(taskData)
        .catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, taskData, (updated) =>
            args.device.oAuth2Client.createTask(updated)
          )
        );

      return true;
    });

    actionProjectTask.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );

    actionProjectTask.registerArgumentAutocompleteListener(
      'assignee',
      this.collaboratorAutocompleteListener
    );
  }

  registerProjectDueStringTaskAction() {
    const actionProjectDueStringTask = this.homey.flow.getActionCard(
      'action_project_due_string_task'
    );

    actionProjectDueStringTask.registerRunListener(async (args, state) => {
      const taskData = {
        content: args.content,
        project_id: args.project.id,
        due_string: args.due_string,
        priority: args.priority,
        assignee_id: args.assignee?.id,
      };

      await args.device.oAuth2Client
        .createTask(taskData)
        .catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, taskData, (updated) =>
            args.device.oAuth2Client.createTask(updated)
          )
        );

      return true;
    });

    actionProjectDueStringTask.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );

    actionProjectDueStringTask.registerArgumentAutocompleteListener(
      'assignee',
      this.collaboratorAutocompleteListener
    );
  }

  registerProjectDueDateTaskAction() {
    const actionProjectDueDateTask = this.homey.flow.getActionCard('action_project_due_date_task');

    actionProjectDueDateTask.registerRunListener(async (args, state) => {
      const due_date = args.due_date.split('-').reverse().join('-');

      const taskData = {
        content: args.content,
        project_id: args.project.id,
        due_date: due_date,
        priority: args.priority,
        assignee_id: args.assignee?.id,
      };

      await args.device.oAuth2Client
        .createTask(taskData)
        .catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, taskData, (updated) =>
            args.device.oAuth2Client.createTask(updated)
          )
        );

      return true;
    });

    actionProjectDueDateTask.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );

    actionProjectDueDateTask.registerArgumentAutocompleteListener(
      'assignee',
      this.collaboratorAutocompleteListener
    );
  }

  registerProjectDueDateDueTimeTaskAction() {
    const actionProjectDueDateDueTimeTask = this.homey.flow.getActionCard(
      'action_project_due_date_due_time_task'
    );

    actionProjectDueDateDueTimeTask.registerRunListener(async (args, state) => {
      const due_date_parts = args.due_date.split('-').reverse();
      const due_time_parts = args.due_time.split(':');

      const date = new Date(
        due_date_parts[0],
        due_date_parts[1] - 1,
        due_date_parts[2],
        due_time_parts[0],
        due_time_parts[1]
      );

      const systemDate = new Date();
      systemDate.setMinutes(0, 0, 0);

      const timeZoneDate = new Date(
        systemDate.toLocaleString('en-US', {
          timeZone: this.homey.clock.getTimezone(),
          hour12: false,
        })
      );
      timeZoneDate.setMinutes(0, 0, 0);

      const offset = systemDate.getTime() - timeZoneDate.getTime();
      const actualDate = new Date(date.getTime() + offset);

      const taskData = {
        content: args.content,
        project_id: args.project.id,
        due_datetime: actualDate.toISOString(),
        priority: args.priority,
        assignee_id: args.assignee?.id,
      };

      await args.device.oAuth2Client
        .createTask(taskData)
        .catch((err) =>
          this.handleDeprecatedProjectId(err, args.device, taskData, (updated) =>
            args.device.oAuth2Client.createTask(updated)
          )
        );

      return true;
    });

    actionProjectDueDateDueTimeTask.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );

    actionProjectDueDateDueTimeTask.registerArgumentAutocompleteListener(
      'assignee',
      this.collaboratorAutocompleteListener
    );
  }

  registerFetchProjectTasksAction() {
    const actionFetchProjectTasks = this.homey.flow.getActionCard('action_fetch_project_tasks');

    actionFetchProjectTasks.registerRunListener(async (args, state) => {
      const tasksData = {
        project_id: args.project.id,
      };

      const tasks = await args.device.oAuth2Client.getTasks(tasksData).catch((err) =>
        this.handleDeprecatedProjectId(err, args.device, tasksData, (updated) =>
          args.device.oAuth2Client.getTasks(updated)
        )
      );

      const taskStrings = [];

      taskStrings.push(`${this.homey.__('project')}: ${args.project.name}`);

      const bull = String.fromCharCode(0x2022);

      if (tasks.length === 0) {
        taskStrings.push(this.homey.__('emptyTasks'));
      }

      for (const task of tasks) {
        if (task.due != null) {
          taskStrings.push(`${bull} ${task.content}\n- ${task.due.string}`);
          continue;
        }

        taskStrings.push(`${bull} ${task.content}`);
      }

      const triggerTokens = {
        tasks: taskStrings.join('\n'),
      };

      const triggerState = {
        project_id: args.project.id,
      };

      await this.projectTasksFetchedDeviceTriggerCard.trigger(
        args.device,
        triggerTokens,
        triggerState
      );

      return true;
    });

    actionFetchProjectTasks.registerArgumentAutocompleteListener(
      'project',
      this.projectAutocompleteListener
    );
  }

  async projectAutocompleteListener(query, args) {
    const projects = await args.device.oAuth2Client.getProjects();

    const mapped = projects.map((project) => {
      return {
        id: project.id,
        name: project.name,
      };
    });

    return mapped.filter((project) => {
      return project.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  async collaboratorAutocompleteListener(query, args) {
    if(!args.project || !args.project.id) {
      return [];
    }

    const collaboratorsData = { project_id: args.project.id };
    const collaborators = await args.device.oAuth2Client.getCollaborators(collaboratorsData).catch((err) =>
      this.handleDeprecatedProjectId(err, args.device, collaboratorsData, (updated) =>
        args.device.oAuth2Client.getCollaborators(updated)
      )
    );

    const mapped = collaborators.map((collaborator) => {
      return {
        id: collaborator.id,
        name: collaborator.name,
      };
    });

    return mapped.filter((project) => {
      return project.name.toLowerCase().includes(query.toLowerCase());
    });
  }

  /**
   * Handle deprecated project ID errors by resolving a new ID and delegating retries to the provided callback.
   * In our case, this only applies to project identifiers as we didn't use any other deprecated IDs.
   * https://developer.todoist.com/api/v1/?shell#tag/Ids/operation/id_mappings_api_v1_id_mappings__obj_name___obj_ids__get
   * @param {*} err the error thrown from the API call
   * @param {*} device the device making the API call
   * @param {*} payload the original payload sent to the API
   * @param {Function} retryCallback callback that receives an updated payload when a new ID is found
   * @returns {Promise<*>} the result of the retryCallback when successful
   */
  async handleDeprecatedProjectId(err, device, payload, retryCallback) {
    if (err.message !== 'The ID provided was deprecated and cannot be used with this version of the API')
      throw err;

    const mappings = await device.oAuth2Client.getIdMappings({
      object_name: 'projects',
      ids: [payload.project_id],
    });

    this.log('Translated deprecated project ID', payload.project_id, 'to new ID', mappings);
    const newProjectId = mappings[0]?.new_id;

    if (newProjectId == null) throw err;

    return retryCallback({
      ...payload,
      project_id: newProjectId,
    });
  }
}

module.exports = UserDriver;
