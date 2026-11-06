<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminGeneralTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_general_dashboard_and_partner_actions_are_protected_and_audited(): void
    {
        $this->postJson('/api/auth/register', [
            'restaurant_name' => 'Le Nouveau',
            'name' => 'Nouveau partenaire',
            'email' => 'partner@example.test',
            'password' => 'secure-pass-123',
        ])->assertCreated();
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'restaurant.registered',
            'metadata' => json_encode(['status' => 'pending']),
        ]);

        $partner = User::where('email', 'partner@example.test')->firstOrFail();
        $adminToken = $this->createToken(User::create([
            'name' => 'Admin général',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
            'role' => 'admin',
        ]));
        $partnerToken = $this->createToken($partner);

        $this->getJson('/api/admin/dashboard')->assertUnauthorized();
        $this->withToken($partnerToken)->getJson('/api/admin/dashboard')->assertForbidden();

        $this->withToken($adminToken)
            ->getJson('/api/admin/dashboard')
            ->assertOk()
            ->assertJsonPath('restaurants.total', 1)
            ->assertJsonPath('restaurants.pending', 1)
            ->assertJsonPath('users.customers', null)
            ->assertJsonPath('subscriptions.revenue', null);

        $this->withToken($adminToken)
            ->getJson('/api/admin/restaurants?status=pending&search=Nouveau')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.status', 'pending');

        $this->withToken($adminToken)
            ->patchJson("/api/admin/restaurants/{$partner->restaurant_id}", [
                'name' => 'Le Nouveau Modifié',
                'partner_name' => 'Responsable mis à jour',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'Le Nouveau Modifié')
            ->assertJsonPath('partner.name', 'Responsable mis à jour');

        $this->withToken($adminToken)
            ->patchJson("/api/admin/restaurants/{$partner->restaurant_id}/status", ['status' => 'active'])
            ->assertOk()
            ->assertJsonPath('status', 'active');

        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => User::where('email', 'admin@example.test')->value('id'),
            'restaurant_id' => $partner->restaurant_id,
            'action' => 'restaurant.status_updated',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => User::where('email', 'admin@example.test')->value('id'),
            'restaurant_id' => $partner->restaurant_id,
            'action' => 'restaurant.updated_by_admin',
        ]);
        $statusAudit = AuditLog::where('action', 'restaurant.status_updated')->firstOrFail();
        $this->assertSame('pending', $statusAudit->metadata['from']);

        $this->withToken($partnerToken)
            ->getJson('/api/auth/me')
            ->assertOk();

        $this->withToken($adminToken)
            ->patchJson("/api/admin/restaurants/{$partner->restaurant_id}/status", [
                'status' => 'suspended',
                'reason' => 'Documents à vérifier',
            ])
            ->assertOk()
            ->assertJsonPath('suspension_reason', 'Documents à vérifier')
            ->assertJsonStructure(['suspended_at']);

        $this->withToken($partnerToken)
            ->getJson('/api/auth/me')
            ->assertForbidden();
    }

    public function test_partner_cannot_change_its_own_status_through_restaurant_update(): void
    {
        $this->postJson('/api/auth/register', [
            'restaurant_name' => 'Le Partenaire',
            'name' => 'Partenaire',
            'email' => 'partner@example.test',
            'password' => 'secure-pass-123',
        ])->assertCreated();

        $partner = User::where('email', 'partner@example.test')->firstOrFail();
        Restaurant::whereKey($partner->restaurant_id)->update(['status' => 'active']);
        $token = $this->createToken($partner);

        $this->withToken($token)
            ->patchJson("/api/restaurants/{$partner->restaurant_id}", ['status' => 'active'])
            ->assertUnprocessable();
    }

    public function test_global_admin_can_view_a_suspended_partner_read_only_without_switching_identity(): void
    {
        $restaurant = Restaurant::create([
            'name' => 'Restaurant suspendu',
            'email' => 'suspended@example.test',
            'status' => 'suspended',
            'suspension_reason' => 'Documents à vérifier',
            'suspended_at' => now(),
        ]);
        $partner = User::create([
            'name' => 'Partenaire suspendu',
            'email' => 'suspended-partner@example.test',
            'password' => 'secure-pass-123',
            'role' => 'partner',
            'restaurant_id' => $restaurant->id,
        ]);
        $category = Category::create([
            'restaurant_id' => $restaurant->id,
            'name' => 'Plats suspendus',
        ]);
        $otherRestaurant = Restaurant::create([
            'name' => 'Autre restaurant',
            'email' => 'other@example.test',
            'status' => 'active',
        ]);
        Category::create([
            'restaurant_id' => $otherRestaurant->id,
            'name' => 'Catégorie privée',
        ]);
        Product::create([
            'restaurant_id' => $restaurant->id,
            'category_id' => $category->id,
            'name' => 'Plat suspendu',
            'price' => 1200,
            'available_quantity' => 3,
            'is_available' => true,
            'is_active' => true,
        ]);
        $admin = User::create([
            'name' => 'Admin général',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
            'role' => 'admin',
        ]);
        $adminToken = $this->createToken($admin);
        $partnerToken = $this->createToken($partner);

        $this->withToken($adminToken)
            ->getJson("/api/admin/restaurants/{$restaurant->id}/view")
            ->assertOk()
            ->assertJsonPath('restaurant_id', $restaurant->id);

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('id', $admin->id)
            ->assertJsonPath('role', 'partner')
            ->assertJsonPath('restaurant.name', $restaurant->name);

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->getJson('/api/restaurants')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $restaurant->id);

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->getJson('/api/categories')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', 'Plats suspendus');

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->postJson('/api/categories', ['name' => 'Écriture interdite'])
            ->assertForbidden()
            ->assertJsonPath('message', 'Le mode de consultation administrateur est en lecture seule.');

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->getJson('/api/admin/dashboard')
            ->assertForbidden();

        $this->withToken($adminToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->postJson('/api/public/orders', [])
            ->assertForbidden()
            ->assertJsonPath('message', 'Le mode de consultation administrateur ne permet pas de passer une commande.');

        $this->withToken($partnerToken)
            ->withHeader('X-Admin-View-Restaurant', (string) $restaurant->id)
            ->getJson('/api/categories')
            ->assertForbidden();

        $this->withToken($adminToken)
            ->postJson('/api/admin/partner-view/close', ['restaurant_id' => $restaurant->id])
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => $admin->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.started',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => $admin->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.read',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => $admin->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.write_blocked',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => $admin->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.public_order_blocked',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'actor_id' => $admin->id,
            'restaurant_id' => $restaurant->id,
            'action' => 'admin.partner_view.ended',
        ]);
    }

    private function createToken(User $user): string
    {
        $token = Str::random(80);
        ApiToken::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $token),
            'type' => 'access',
            'expires_at' => now()->addHour(),
        ]);

        return $token;
    }
}
