---
name: pr-jira
description: Sync Pull Request and Jira ticket. Appends the Jira ticket link to the PR description and the PR link to the Jira ticket.
---

# Sync Pull Request and Jira ticket

**Important**: No mentions to Claude or any other AI whatsoever in any commit or pull request or anywhere else.

1. Identify the relevant Jira issue for the current branch:
   - Search my active issues on Jira to find the matching issue
   - If you can't identify the correct issue, ask the user for the issue ID
2. Append the Jira issue link to the bottom of the Pull Request description using the format: `[ISSUE-ID](jira_url)`
   - Example: `[PROJ-1234](https://jira.example.com/browse/PROJ-1234)`
   - This ensures GitHub renders it as a clickable link with the issue ID as the display text
3. Append the Pull Request URL to the bottom of the Jira ticket description
