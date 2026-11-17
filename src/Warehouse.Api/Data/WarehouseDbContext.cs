namespace Warehouse.Api.Data;

using Microsoft.EntityFrameworkCore;
using Warehouse.Api.Models;

public class WarehouseDbContext(DbContextOptions<WarehouseDbContext> options) : DbContext(options)
{
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Rack> Racks => Set<Rack>();
    public DbSet<Obstacle> Obstacles => Set<Obstacle>();
    public DbSet<Slot> Slots => Set<Slot>();
    public DbSet<PalletSize> PalletSizes => Set<PalletSize>();
    public DbSet<ProductType> ProductTypes => Set<ProductType>();
    public DbSet<Batch> Batches => Set<Batch>();
    public DbSet<Pallet> Pallets => Set<Pallet>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Room>(room =>
        {
            room.HasKey(r => r.Id);
            room.Property(r => r.Name).IsRequired().HasMaxLength(50);
            room.HasIndex(r => r.Name).IsUnique();

            room.HasMany(r => r.Racks)
                .WithOne()
                .HasForeignKey(k => k.RoomId)
                .OnDelete(DeleteBehavior.Cascade);

            room.HasMany(r => r.Obstacles)
                .WithOne()
                .HasForeignKey(o => o.RoomId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<Obstacle>(obstacle =>
        {
            obstacle.HasKey(o => o.Id);
            obstacle.Property(o => o.Kind).HasConversion<string>().HasMaxLength(20);
        });

        model.Entity<Rack>(rack =>
        {
            rack.HasKey(k => k.Id);
            rack.Property(k => k.Code).IsRequired().HasMaxLength(20);

            rack.HasIndex(k => new { k.RoomId, k.Code }).IsUnique();
        });

        model.Entity<Slot>(slot =>
        {
            slot.HasKey(s => s.Id);
            slot.Property(s => s.Code).IsRequired().HasMaxLength(40);
            slot.Property(s => s.AssignedSize).HasMaxLength(10);

            slot.HasOne<Rack>()
                .WithMany()
                .HasForeignKey(s => s.RackId)
                .OnDelete(DeleteBehavior.Cascade);

            slot.HasIndex(s => new { s.RackId, s.Code }).IsUnique();

            slot.HasOne<Pallet>()
                .WithMany()
                .HasForeignKey(s => s.PalletId)
                .OnDelete(DeleteBehavior.Restrict);

            slot.HasIndex(s => s.PalletId).IsUnique();
        });

        model.Entity<PalletSize>(size =>
        {
            size.HasKey(s => s.Id);
            size.Property(s => s.Code).IsRequired().HasMaxLength(10);
            size.Property(s => s.Color).IsRequired().HasMaxLength(20);
            size.HasIndex(s => s.Code).IsUnique();
        });

        model.Entity<ProductType>(type =>
        {
            type.HasKey(t => t.Id);
            type.Property(t => t.Code).IsRequired().HasMaxLength(20);
            type.Property(t => t.Name).IsRequired().HasMaxLength(50);
            type.HasIndex(t => t.Code).IsUnique();
        });

        model.Entity<Rack>()
            .HasOne<ProductType>()
            .WithMany()
            .HasForeignKey(k => k.ProductTypeId)
            .OnDelete(DeleteBehavior.Restrict);

        model.Entity<Batch>(batch =>
        {
            batch.HasKey(b => b.Id);
            batch.Property(b => b.Code).IsRequired().HasMaxLength(20);
            batch.HasIndex(b => b.Code).IsUnique();

            batch.HasMany(b => b.Pallets)
                 .WithOne()
                 .HasForeignKey(p => p.BatchId)
                 .OnDelete(DeleteBehavior.Cascade);
        });

        model.Entity<Pallet>(pallet =>
        {
            pallet.HasKey(p => p.Id);
            pallet.Property(p => p.Code).IsRequired().HasMaxLength(30);
            pallet.HasIndex(p => p.Code).IsUnique();

            pallet.HasOne(p => p.Size)
                  .WithMany()
                  .HasForeignKey(p => p.SizeId)
                  .OnDelete(DeleteBehavior.Restrict);

            pallet.HasOne<ProductType>()
                  .WithMany()
                  .HasForeignKey(p => p.ProductTypeId)
                  .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
