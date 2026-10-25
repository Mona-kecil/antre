<svelte:head
	><title>Privacy · antre</title><meta
		name="description"
		content="How Antre stores account connections, drafts, and publishing data."
	/></svelte:head
>

<main>
	<h1>Privacy</h1>
	<p>
		Antre gives each signed-in person a workspace for reviewing drafts and scheduling posts. The public demo uses sample data in your browser and does not publish posts.
	</p>
	<h2>What Antre stores</h2>
	<p>
		Antre stores connected account identifiers and display names, access tokens
		and their expiry times, drafts, attachments, posting schedules, and
		publishing results. Its Threads features also store replies and engagement
		data obtained through the account connection.
	</p>
	<h2>How the data is used</h2>
	<p>
		Account access lets Antre publish posts that the owner queues or chooses to
		publish. Drafts remain in Antre until the owner sends them. LinkedIn and
		Threads have separate drafts and schedules.
	</p>
	<h2>Where data goes</h2>
	<p>
		WorkOS manages sign-in. An encrypted, HTTP-only cookie keeps your browser session. Vercel hosts the application. Convex stores workspace data and runs
		publishing jobs. Publishing sends the selected post to its connected
		platform. An agent given access to Antre's MCP endpoint can read and change
		content through the tools exposed there.
	</p>
	<h2>Access and removal</h2>
	<p>
		Use Settings to disconnect a posting profile, revoke an agent key, or delete your workspace. Signing out ends your browser session; scheduled posts keep publishing. Disconnecting a profile holds its queued posts until you reconnect. Deleting your workspace stops its queue and removes its stored data and credentials. Posts already published on LinkedIn or Threads remain online. A request in flight may still publish.
	</p>
	<p>
		For a request about this app or stored data, contact the maintainer through <a
			href="https://github.com/Mona-kecil/antre/issues">the Antre repository</a
		>. Do not include passwords or access tokens in an issue.
	</p>
	<p><a href="/">Back to Antre</a></p>
</main>

<style>
	main {
    max-width: 600px;
    margin: 0 auto;
		padding: 32px 20px;
	}
	h1 {
		font-size: 20px;
		line-height: 1.3;
		margin: 0 0 20px;
	}
	h2 {
		font-size: 17px;
		margin: 28px 0 8px;
	}
	p {
		margin: 0 0 16px;
		line-height: 1.65;
	}
	a {
		color: inherit;
		text-underline-offset: 3px;
	}
</style>
