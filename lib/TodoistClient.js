const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const { URLSearchParams } = require('url');

class TodoistClient extends OAuth2Client {
  // Required:
  // static API_URL = 'https://api.todoist.com';
  // static TOKEN_URL = 'https://todoist.com/oauth/access_token';
  // static AUTHORIZATION_URL = 'https://todoist.com/oauth/authorize';
  // static SCOPES = [ 'data:read_write' ];

  // Optional:
  // static TOKEN = MyBrandOAuth2Token; // Default: OAuth2Token
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  async syncUser() {
    const params = new URLSearchParams();
    params.append('token', this._token.access_token);
    params.append('sync_token', '*');
    params.append('resource_types', '["user"]');

    return await this.post({
      path: '/sync/v9/sync',
      body: params,
    });
  }

  async createTask({
    // these are the ones from Flow
    // destructured due to visibility whats possible
    content,
    project_id,
    due_date,
    due_datetime,
    due_string,
    priority,
    assignee_id,
    ...rest
  }) {
    return this.post({
      path: '/api/v1/tasks',
      json: {
        content: content,
        project_id: project_id,
        due_date: due_date,
        due_datetime: due_datetime,
        due_string: due_string,
        priority: priority,
        assignee_id: assignee_id,
        ...rest,
      },
    });
  }

  async updateTask(task_id, body) {
    return this.post({
      path: `/api/v1/tasks/${task_id}`,
      json: body,
    });
  }

  async closeTask(task_id) {
    return this.post({
      path: `/api/v1/tasks/${task_id}/close`,
    });
  }

  async reopenTask(task_id) {
    return this.post({
      path: `/api/v1/tasks/${task_id}/reopen`,
    });
  }

  async deleteTask(task_id) {
    return this.delete({
      path: `/api/v1/tasks/${task_id}`,
    });
  }

  async getTasks({ project_id } = {}) {
     // Query does not accept undefined. It will cause a bad request.
    const query = {};

    if (project_id != null) {
      query.project_id = project_id;
    }

    return this.getPaginatedResults({
      path: '/api/v1/tasks',
      query,
    });
  }

  async getTasksByFilter({ filter }) {
    const query = {
      query: filter
    };

    return this.getPaginatedResults({
      path: '/api/v1/tasks/filter',
      query,
    });
  }

  async getTask({ task_id }) {
    return this.get({
      path: `/api/v1/tasks/${task_id}`,
    });
  }

  async getProjects() {
    if (this._projects) {
      return await this._projects;
    }

    this._projects = (async () => {
      return this.getPaginatedResults({
        path: '/api/v1/projects ',
      });
    })();

    await this._projects;

    this.homey.clearTimeout(this._timeout);

    this._timeout = this.homey.setTimeout(() => {
      this._projects = null;
    }, 60000);

    return this._projects;
  }

  async getProject({ project_id }) {
    return this.get({
      path: `/api/v1/projects/${project_id}`,
    });
  }

  async getCollaborators({ project_id }) {
    return this.getPaginatedResults({
      path: `/api/v1/projects/${project_id}/collaborators`,
    });
  }

  async getIdMappings({ object_name, ids }) {
    this.log('getIdMappings using url', `/api/v1/id_mappings/${object_name}/${ids.join(',')}`);
    return this.get({
      path: `/api/v1/id_mappings/${object_name}/${ids.join(',')}`,
    });
  }

  async getPaginatedResults({ path, query = {} }) {
    const results = [];
    let cursor = null;

    do {
      const response = await this.get({
        path,
        query: {
          ...query,
          ...(cursor ? { cursor } : {}),
        },
      });

      if (!Array.isArray(response?.results)) {
        return [];
      }

      results.push(...response.results);
      cursor = response.next_cursor;
    } while (cursor != null);

    return results;
  }

  /**
   * @override
   * @param body
   * @param status
   * @param statusText
   * @param headers
   * @return {Promise<void>}
   */
  async onHandleNotOK({ body, status, statusText, headers }) {
    if (typeof body === 'string') {
      const error = new Error(statusText);
      error.message = body;
      error.status = status;
      error.statusText = statusText;
      throw error;
    }

    throw new OAuth2Error(body.error);
  }
}

module.exports = { TodoistClient };
