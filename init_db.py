import asyncio
from database import engine, AsyncSessionFactory
from models import Base, Team, Agent, Session

async def main():
    print("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables created successfully!")

    async with AsyncSessionFactory() as session:
        existing_team = await session.get(Team, "team-1")
        if not existing_team:
            team = Team(id="team-1", name="Engineering Team", monthly_budget_usd=500.00)
            agent = Agent(
                id="agent-1",
                team_id="team-1",
                name="Coder Agent",
                monthly_budget_usd=50.00,
                preferred_model="llama-3.3-70b-versatile",
                fallback_model="llama-3.1-8b-instant",
            )
            session_obj = Session(
                id="session-1",
                agent_id="agent-1",
                budget_usd=5.00,
                status="active",
            )
            session.add_all([team, agent, session_obj])
            await session.commit()
            print("Default team, agent, and session seeded successfully!")

if __name__ == "__main__":
    asyncio.run(main())
